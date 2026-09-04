import {onRequest} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {headObject, deleteObject, listObjectKeys, buildPublicUrl, getBucketName, getRegion} from '../../lib/s3';
import {recordingStorageKeyPrefix} from '../../live/recording';
import {createDraftPostFromRecording} from '../../live/recordingPost';
import {verifyAgoraWebhookSignature} from '../../lib/agoraWebhookVerify';
import {AGORA_CLOUD_RECORDING_WEBHOOK_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../../config';

// Agora Cloud Recording's real, documented webhook event types — see
// https://docs.agora.io/en/cloud-recording/develop/receive-notifications.
// Confirmed from Agora's current docs, not guessed.
const EVENT_ERROR = 1;
const EVENT_UPLOADED = 31;
const EVENT_UPLOADING_PROGRESS = 33;

interface RecordingWebhookPayload {
  eventType?: number;
  sid?: string;
  payload?: {
    // Confirmed against Agora's current docs AND a real captured webhook
    // call (2026-09-04): eventType/sid are top-level, but fileList/progress
    // are nested one level deeper than the docs' top-level example implied
    // — under payload.details, not payload directly. The first deploy of
    // this handler read payload.fileList/payload.progress and silently
    // no-op'd on every real call as a result.
    details?: {
      progress?: number; // 0-10000
      fileList?: Array<{fileName: string; trackType?: string; uid?: string}>;
      errorMsg?: string;
    };
  };
}

/**
 * Receives Agora Cloud Recording's progress/completion/error events and
 * drives the whole post-live pipeline from here — the query REST endpoint
 * is never polled, this webhook is the sole source of truth. Configure in
 * Agora Console: Webhooks -> New Webhook -> product "Cloud Recording" ->
 * this function's URL -> copy the generated Signing Secret into
 * AGORA_CLOUD_RECORDING_WEBHOOK_SECRET.
 *
 * Looked up by recordingSid (single-field equality, no composite index
 * needed) rather than channel name — Cloud Recording's envelope carries
 * `sid`, not the channel/liveId directly.
 */
// Also declares the AWS secrets — headObject/buildPublicUrl below construct
// a real S3 client (see lib/s3.ts), same "every transitively-touched secret
// must be declared on THIS function" reasoning as the other live functions.
export const onRecordingEvent = onRequest(
  {cors: false, secrets: [AGORA_CLOUD_RECORDING_WEBHOOK_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY]},
  async (request, response) => {
    const signature = request.header('Agora-Signature-V2');
    if (!signature) {
      response.status(400).send('Missing signature header');
      return;
    }

    const rawBody = request.rawBody?.toString('utf8') ?? '';
    const valid = verifyAgoraWebhookSignature(AGORA_CLOUD_RECORDING_WEBHOOK_SECRET.value(), signature, rawBody);
    if (!valid) {
      response.status(401).send('Invalid signature');
      return;
    }

    let event: RecordingWebhookPayload;
    try {
      event = JSON.parse(rawBody);
    } catch {
      response.status(400).send('Invalid JSON');
      return;
    }

    if (!event.sid) {
      response.status(200).send('ok'); // nothing actionable — still 200 so Agora doesn't retry
      return;
    }

    const query = await db.collection('liveSessions').where('recordingSid', '==', event.sid).limit(1).get();
    if (query.empty) {
      response.status(200).send('ok');
      return;
    }
    const liveDoc = query.docs[0];
    const liveId = liveDoc.id;
    const data = liveDoc.data();

    console.log('[onRecordingEvent] received', {
      liveId,
      eventType: event.eventType,
      sid: event.sid,
      details: event.payload?.details,
    });

    if (event.eventType === EVENT_UPLOADING_PROGRESS) {
      const progress = event.payload?.details?.progress;
      if (typeof progress === 'number') {
        await liveDoc.ref.update({recordingStatus: 'uploading', recordingProgress: progress});
      }
    } else if (event.eventType === EVENT_UPLOADED) {
      // fileList now also contains the HLS .m3u8/.ts files (avFileType is
      // ['hls','mp4'] — Agora requires hls alongside mp4, see recording.ts's
      // own note) — pick the actual .mp4 out specifically, never just [0].
      const fileEntry = event.payload?.details?.fileList?.find((f) => f.fileName.toLowerCase().endsWith('.mp4'));
      if (!fileEntry?.fileName) {
        // Seen in practice: Agora can send more than one "uploaded" call per
        // sid (e.g. an HLS-only fileList before the mp4 is ready) — log
        // instead of silently dropping it so we can tell whether a later
        // call ever arrives with the mp4, or whether this needs handling.
        console.log('[onRecordingEvent] uploaded event has no .mp4 entry yet, ignoring this call', {liveId, fileList: event.payload?.details?.fileList});
      }
      if (fileEntry?.fileName) {
        try {
          // Confirmed against a real webhook call (2026-09-04): Agora's
          // fileName is already the full bucket key, including the
          // fileNamePrefix we passed to `start` (recordingStorageKeyPrefix)
          // — not a bare filename. Prepending the prefix again produced a
          // doubled, nonexistent key (liveRecordings/{id}/liveRecordings/{id}/...).
          const storageKey = fileEntry.fileName;
          const object = await headObject(storageKey);
          if (object) {
            const url = buildPublicUrl(storageKey, getBucketName(), getRegion());
            const postId = await createDraftPostFromRecording(liveId, data.hostId as string, (data.title as string) ?? '', data.visibility === 'private' ? 'private' : 'public', {
              url,
              storageKey,
              mimeType: 'video/mp4',
              fileSize: object.sizeBytes,
              width: 720,
              height: 1280,
            });
            await liveDoc.ref.update({recordingStatus: 'ready', recordingProgress: 10000, recordingPostId: postId});

            // The post only ever needs the mp4 — the HLS .m3u8/.ts files
            // Agora also uploaded (avFileType required 'hls' alongside
            // 'mp4', see recording.ts) are pure leftover clutter once it's
            // finalized. Clean up by LISTING the actual bucket prefix rather
            // than trusting the webhook's own fileList — confirmed in
            // practice that fileList only reports independently-playable
            // outputs (mp4, m3u8) and omits the .ts segments the m3u8
            // playlist references, so relying on it left segments orphaned.
            // Best-effort: the post is already created, so a delete failure
            // here is logged, not surfaced as a recording failure.
            const allKeys = await listObjectKeys(recordingStorageKeyPrefix(liveId));
            const leftoverKeys = allKeys.filter((key) => key !== storageKey);
            await Promise.all(
              leftoverKeys.map((key) =>
                deleteObject(key).catch((err) => console.error('[onRecordingEvent] failed to delete leftover HLS file', {liveId, key}, err)),
              ),
            );
          } else {
            console.error('[onRecordingEvent] uploaded event fired but object not found in S3', {liveId, storageKey});
            await liveDoc.ref.update({recordingStatus: 'failed', recordingError: 'Recording file not found in storage after upload.'});
          }
        } catch (err) {
          console.error('[onRecordingEvent] failed to finalize recording', liveId, err);
          await liveDoc.ref.update({recordingStatus: 'failed', recordingError: 'Failed to finalize the recording.'});
        }
      }
    } else if (event.eventType === EVENT_ERROR) {
      await liveDoc.ref.update({recordingStatus: 'failed', recordingError: event.payload?.details?.errorMsg ?? 'Recording failed.'});
    }

    response.status(200).send('ok');
  },
);
