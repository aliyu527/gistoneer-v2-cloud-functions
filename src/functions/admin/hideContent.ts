import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface HideContentRequest {
  postId: string;
  reason: string;
}

interface HideContentResponse {
  postId: string;
  moderationStatus: 'hidden';
}

/**
 * Sets moderationStatus:'hidden' — the actual enforcement is the narrowed
 * firestore.rules read condition on posts/{postId} (Admin SDK bypasses it,
 * but every other reader is now gated by it). Idempotent: hiding an
 * already-hidden post just re-confirms the state and still logs the action.
 */
export const hideContent = onCall<HideContentRequest, Promise<HideContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'content.moderate');

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

  await postRef.update({moderationStatus: 'hidden', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'content.hide',
    targetType: 'content',
    targetId: postId,
    reason: reason.trim(),
  }).catch(() => {});

  return {postId, moderationStatus: 'hidden'};
});
