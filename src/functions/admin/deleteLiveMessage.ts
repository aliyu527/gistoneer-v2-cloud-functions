import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface DeleteLiveMessageRequest {
  liveId: string;
  messageId: string;
  reason?: string;
}

interface DeleteLiveMessageResponse {
  messageId: string;
  deleted: true;
}

/**
 * Soft-delete only (`deleted: true`) — messages were previously immutable
 * (rules: `write: if false`), so this is genuinely new capability. Reason is
 * optional: chat text is lower-stakes and more transient than a post/sound,
 * not worth a mandatory reason taxonomy that doesn't exist anywhere for chat.
 */
export const deleteLiveMessage = onCall<DeleteLiveMessageRequest, Promise<DeleteLiveMessageResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'live.moderate');

  const liveId = request.data?.liveId;
  const messageId = request.data?.messageId;
  const reason = request.data?.reason;
  if (typeof liveId !== 'string' || liveId.length === 0 || typeof messageId !== 'string' || messageId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing liveId or messageId.');
  }

  const messageRef = db.collection('liveSessions').doc(liveId).collection('messages').doc(messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) {
    throw new HttpsError('not-found', 'This message could not be found.');
  }

  await messageRef.update({deleted: true, deletedBy: admin.uid, deletedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'live.chat.delete',
    targetType: 'live',
    targetId: `${liveId}/${messageId}`,
    reason: reason?.trim() || null,
  }).catch(() => {});

  return {messageId, deleted: true};
});
