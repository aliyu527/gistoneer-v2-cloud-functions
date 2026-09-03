import {HttpsError} from 'firebase-functions/v2/https';
import {AGORA_APP_ID, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AGORA_MEDIA_GATEWAY_REGION} from '../config';
import {agoraUidFor} from './agoraUid';

// One broadcast session's worth, not Brekete's "5 years" — Gistoneer
// provisions a fresh key per live session rather than a persistent
// per-channel credential, so there's no reason for it to outlive the
// session by much. 6 hours comfortably covers any real broadcast.
const STREAM_KEY_TTL_SECONDS = 6 * 60 * 60;

export interface IngestCredentials {
  rtmpServerUrl: string;
  streamKey: string;
  ingestUid: number;
}

/** Deterministic per-session ingest uid — reuses the same hash every other Agora uid in this app already goes through, just namespaced so it can never collide with a real Firebase uid's own derived value. */
export function externalIngestUidFor(liveId: string): number {
  return agoraUidFor(`rtmp:${liveId}`);
}

function ingestServerUrl(region: string): string {
  return `rtmp://rtls-ingress-prod-${region}.agoramdn.com/live`;
}

/**
 * Agora Media Gateway's real, documented stream-key provisioning API — see
 * https://docs.agora.io/en/api-reference/api-ref/rtmp-gateway/create-streaming-key.
 * Confirmed (not guessed) via Agora's current docs: POST .../rtls/ingress/
 * streamkeys, Basic auth with the RESTful API Customer ID/Secret (same
 * credential type Cloud Recording's REST API uses — different from the App
 * Certificate), uid is caller-specified so the ingested stream joins the
 * channel as an ordinary participant with a known uid.
 */
export async function provisionIngestCredentials(liveId: string, channelName: string): Promise<IngestCredentials> {
  const region = AGORA_MEDIA_GATEWAY_REGION.value();
  if (!region) {
    throw new HttpsError('failed-precondition', 'External live streaming is not configured yet.');
  }
  const ingestUid = externalIngestUidFor(liveId);
  const appId = AGORA_APP_ID.value();
  const auth = Buffer.from(`${AGORA_CUSTOMER_ID.value()}:${AGORA_CUSTOMER_SECRET.value()}`).toString('base64');

  const res = await fetch(`https://api.agora.io/${region}/v1/projects/${appId}/rtls/ingress/streamkeys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      settings: {
        channel: channelName,
        uid: String(ingestUid),
        expiresAfter: STREAM_KEY_TTL_SECONDS,
      },
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    // TEMPORARY diagnostic — surface Agora's actual rejection reason instead
    // of just the status code, while verifying this brand-new integration.
    console.error('[mediaGateway] streamkeys request rejected', {status: res.status, body: rawBody});
    throw new HttpsError('internal', `Agora Media Gateway rejected the stream-key request (${res.status}): ${rawBody}`);
  }
  const body = JSON.parse(rawBody) as {data?: {streamKey?: string}};
  const streamKey = body.data?.streamKey;
  if (!streamKey) {
    console.error('[mediaGateway] streamkeys response missing streamKey', {body: rawBody});
    throw new HttpsError('internal', `Agora Media Gateway didn't return a stream key. Response: ${rawBody}`);
  }

  return {rtmpServerUrl: ingestServerUrl(region), streamKey, ingestUid};
}
