import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface RemoveContentRequest {
  postId: string;
  reason: string;
}

interface RemoveContentResponse {
  postId: string;
  moderationStatus: 'removed';
}

/**
 * Soft-delete only — sets moderationStatus:'removed', never deletes the
 * document or its S3 media (spec §29/§40 explicitly forbid treating a
 * moderation action as data destruction). Same read-rule enforcement as
 * hideContent. Requires content.delete (a higher tier than content.moderate)
 * since this is the more severe action.
 */
export const removeContent = onCall<RemoveContentRequest, Promise<RemoveContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'content.delete');

  const postId = request.data?.postId;
  const reason = request.data?.reason;
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing postId.');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists || postSnap.data()?.status !== 'published') {
    throw new HttpsError('not-found', 'This content could not be found.');
  }

  await postRef.update({moderationStatus: 'removed', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'content.remove',
    targetType: 'content',
    targetId: postId,
    reason: reason.trim(),
  }).catch(() => {});

  return {postId, moderationStatus: 'removed'};
});
