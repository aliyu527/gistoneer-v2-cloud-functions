import {RtcTokenBuilder, RtcRole} from 'agora-token';
import {AGORA_APP_ID, AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';
import {getBucketName, getRegion} from '../lib/s3';
import {agoraUidFor} from './agoraUid';

const RECORDING_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour — comfortably covers any real broadcast; recording stops well before this in normal use

// Amazon S3 vendor id + region-code table for Agora Cloud Recording's
// storageConfig — confirmed against Agora's current docs
// (docs.agora.io/en/api-reference/api-ref/cloud-recording/start), not
// guessed. Only the regions this app is plausibly configured for are
// mapped; an unmapped AWS_REGION fails loudly rather than silently
// recording to the wrong place.
const S3_VENDOR = 1;
const AWS_REGION_TO_AGORA_CODE: Record<string, number> = {
  'us-east-1': 0,
  'us-east-2': 1,
  'us-west-1': 2,
  'us-west-2': 3,
  'eu-west-1': 4,
  'eu-west-2': 5,
  'eu-west-3': 6,
  'eu-central-1': 7,
  'ap-southeast-1': 8,
  'ap-southeast-2': 9,
  'ap-northeast-1': 10,
  'ap-northeast-2': 11,
  'sa-east-1': 12,
  'ca-central-1': 13,
  'ap-south-1': 14,
  'eu-north-1': 21,
  'me-south-1': 22,
  'ap-southeast-3': 24,
  'eu-south-1': 25,
};

const RECORDING_FILE_PREFIX = 'liveRecordings';

export function recordingUidFor(liveId: string): number {
  return agoraUidFor(`recording:${liveId}`);
}

export function recordingStorageKeyPrefix(liveId: string): string {
  return `${RECORDING_FILE_PREFIX}/${liveId}`;
}

class RecordingUnavailableError extends Error {}

function agoraRegionCode(): number {
  const region = getRegion();
  const code = AWS_REGION_TO_AGORA_CODE[region];
  if (code === undefined) {
    throw new RecordingUnavailableError(`No Agora storage-region mapping for AWS region "${region}" — add it to AWS_REGION_TO_AGORA_CODE.`);
  }
  return code;
}

async function cloudRecordingRequest(path: string, body: unknown): Promise<Record<string, unknown>> {
  const appId = AGORA_APP_ID.value();
  const auth = Buffer.from(`${AGORA_CUSTOMER_ID.value()}:${AGORA_CUSTOMER_SECRET.value()}`).toString('base64');

  const res = await fetch(`https://api.agora.io/v1/apps/${appId}/cloud_recording/${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Basic ${auth}`},
    body: JSON.stringify(body),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    console.error('[recording] cloud_recording request rejected', {path, status: res.status, body: rawBody});
    throw new RecordingUnavailableError(`Agora Cloud Recording rejected ${path} (${res.status}): ${rawBody}`);
  }
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error('[recording] cloud_recording response not JSON', {path, body: rawBody});
    throw new RecordingUnavailableError(`Agora Cloud Recording returned an unexpected response for ${path}.`);
  }
}

export interface StartedRecording {
  resourceId: string;
  sid: string;
  recordingUid: number;
}

/**
 * Acquires a Cloud Recording resource then immediately starts a composite
 * ("mix") recording — one combined MP4 of every publisher in the channel
 * (host + any co-host speakers), uploaded by Agora directly into this app's
 * existing S3 album bucket under liveRecordings/{liveId}/... (no bytes ever
 * pass through this Cloud Function). Callers (goLive) treat any failure
 * here as non-fatal — going live must never be blocked by recording setup.
 */
export async function startRecording(liveId: string, channelName: string): Promise<StartedRecording> {
  const recordingUid = recordingUidFor(liveId);

  const acquireBody = await cloudRecordingRequest(`acquire`, {
    cname: channelName,
    uid: String(recordingUid),
    clientRequest: {
      scene: 0,
      resourceExpiredHour: 24,
    },
  });
  const resourceId = acquireBody.resourceId as string | undefined;
  if (!resourceId) {
    throw new RecordingUnavailableError('Agora Cloud Recording acquire did not return a resourceId.');
  }

  // A real PUBLISHER-is-not-needed SUBSCRIBER token for the recording bot —
  // it only ever subscribes, never publishes. Same buildTokenWithUid/
  // duration-not-timestamp convention as getLiveToken (see token.ts).
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID.value(),
    AGORA_APP_CERTIFICATE.value(),
    channelName,
    recordingUid,
    RtcRole.SUBSCRIBER,
    RECORDING_TOKEN_TTL_SECONDS,
    RECORDING_TOKEN_TTL_SECONDS,
  );

  const startBody = await cloudRecordingRequest(`resourceid/${resourceId}/mode/mix/start`, {
    cname: channelName,
    uid: String(recordingUid),
    clientRequest: {
      token,
      recordingConfig: {
        channelType: 1, // Live Broadcasting — matches ChannelProfileLiveBroadcasting used everywhere else in this app
        streamTypes: 2, // audio + video
        subscribeAudioUids: ['#allstream#'],
        subscribeVideoUids: ['#allstream#'],
        transcodingConfig: {
          width: 720,
          height: 1280, // portrait — matches how every other video post in this app is shot
          fps: 15,
          bitrate: 800,
          mixedVideoLayout: 1, // adaptive — reasonable for either a single host or host+speakers
        },
      },
      recordingFileConfig: {
        avFileType: ['mp4'], // one continuous playable file, not HLS segments — this becomes a post's video
      },
      storageConfig: {
        vendor: S3_VENDOR,
        region: agoraRegionCode(),
        bucket: getBucketName(),
        accessKey: AWS_ACCESS_KEY_ID.value(),
        secretKey: AWS_SECRET_ACCESS_KEY.value(),
        fileNamePrefix: [RECORDING_FILE_PREFIX, liveId],
      },
    },
  });
  const sid = startBody.sid as string | undefined;
  if (!sid) {
    throw new RecordingUnavailableError('Agora Cloud Recording start did not return a sid.');
  }

  return {resourceId, sid, recordingUid};
}

/** Fire-and-forget from our side — actual upload completion is confirmed asynchronously via the Cloud Recording webhook (onRecordingEvent), not this response. */
export async function stopRecording(channelName: string, resourceId: string, sid: string, recordingUid: number): Promise<void> {
  await cloudRecordingRequest(`resourceid/${resourceId}/sid/${sid}/mode/mix/stop`, {
    cname: channelName,
    uid: String(recordingUid),
    clientRequest: {},
  });
}
