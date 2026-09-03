import {onRequest} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {goLive, stopRecordingIfActive} from '../../live/service';
import {verifyAgoraWebhookSignature} from '../../lib/agoraWebhookVerify';
import {AGORA_MEDIA_GATEWAY_WEBHOOK_SECRET, AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../../config';

// Agora Media Gateway's real, documented webhook event types — see
// https://docs.agora.io/en/media-gateway/reference/rest-api/webhooks/media-gateway-event-type.
// Confirmed from Agora's current docs, not guessed.
const EVENT_CONNECTED = 1;
const EVENT_DISCONNECTED = 2;
const EVENT_ABORTED = 3;

interface MediaGatewayWebhookPayload {
  eventType?: number;
  payload?: {
    rtcInfo?: {
      channel?: string;
      uid?: string | number;
    };
  };
}

/**
 * Receives Agora Media Gateway's connect/disconnect events for an external
 * (OBS/vMix) live session and flips the matching liveSessions/{liveId} doc
 * accordingly — the authoritative "is the encoder actually connected"
 * signal for the External Live UI's onSnapshot listener. Configure in
 * Agora Console: Webhooks -> New Webhook -> product "Media Gateway" -> this
 * function's URL -> copy the generated Signing Secret into
 * AGORA_MEDIA_GATEWAY_WEBHOOK_SECRET.
 *
 * agoraChannelName === liveId by construction (see createLiveSession), so
 * the matching session is a direct doc read, never a query.
 */
// Also declares the Cloud Recording secrets — this webhook calls goLive()
// (start recording) on connect and stopRecordingIfActive() (stop recording)
// on disconnect, same "every transitively-touched secret must be declared
// on THIS function" reasoning as goLive.ts/endLiveSession.ts.
export const onMediaGatewayEvent = onRequest(
  {
    cors: false,
    secrets: [AGORA_MEDIA_GATEWAY_WEBHOOK_SECRET, AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY],
  },
  async (request, response) => {
    const signature = request.header('Agora-Signature-V2');
    if (!signature) {
      response.status(400).send('Missing signature header');
      return;
    }

    const rawBody = request.rawBody?.toString('utf8') ?? '';
    const valid = verifyAgoraWebhookSignature(AGORA_MEDIA_GATEWAY_WEBHOOK_SECRET.value(), signature, rawBody);
    if (!valid) {
      response.status(401).send('Invalid signature');
      return;
    }

    let event: MediaGatewayWebhookPayload;
    try {
      event = JSON.parse(rawBody);
    } catch {
      response.status(400).send('Invalid JSON');
      return;
    }

    const liveId = event.payload?.rtcInfo?.channel;
    const uidRaw = event.payload?.rtcInfo?.uid;
    const uid = uidRaw === undefined ? NaN : Number(uidRaw);

    if (!liveId || !Number.isFinite(uid)) {
      response.status(200).send('ok'); // nothing actionable in this payload — still 200 so Agora doesn't retry
      return;
    }

    const ref = db.collection('liveSessions').doc(liveId);
    const snap = await ref.get();
    if (!snap.exists) {
      response.status(200).send('ok');
      return;
    }
    const data = snap.data()!;

    if (event.eventType === EVENT_CONNECTED) {
      if (data.status === 'starting' && data.externalIngestUid === uid) {
        await goLive(data.hostId as string, liveId, uid);
      }
    } else if (event.eventType === EVENT_DISCONNECTED || event.eventType === EVENT_ABORTED) {
      if (data.status === 'live') {
        // Direct write, not the host-auth-checked endLiveSession callable —
        // this transition is authenticated by the webhook signature above,
        // not a user action.
        await ref.update({status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
        // External Live's end path never goes through endLiveSession() —
        // this is the only place a recording started for an external
        // broadcast ever gets stopped.
        await stopRecordingIfActive(liveId);
      }
    }

    response.status(200).send('ok');
  },
);
