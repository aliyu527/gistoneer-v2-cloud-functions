import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdminAny, assertPermission} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';
import type {ModerationStatus} from './adminListContent';

interface RestoreContentRequest {
  postId: string;
}

interface RestoreContentResponse {
  postId: string;
  moderationStatus: 'active';
}

/**
 * Sets moderationStatus:'active' regardless of prior state, but the
 * permission required depends on how severe that prior state was: undoing a
 * 'removed' (content.delete-tier) requires content.delete, undoing a
 * 'hidden' (content.moderate-tier) only requires content.moderate — so a
 * moderator can't quietly reverse an admin's removal. This is why the
 * permission check happens AFTER reading the post, using the lower-level
 * requireActiveAdminAny + assertPermission instead of the single-permission
 * requireActiveAdmin convenience wrapper.
 */
export const restoreContent = onCall<RestoreContentRequest, Promise<RestoreContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdminAny(request);

  const postId = request.data?.postId;
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing postId.');
  }

  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists || postSnap.data()?.status !== 'published') {
    throw new HttpsError('not-found', 'This content could not be found.');
  }

  const currentStatus = (postSnap.data()?.moderationStatus as ModerationStatus) ?? 'active';
  assertPermission(admin, currentStatus === 'removed' ? 'content.delete' : 'content.moderate');

  await postRef.update({moderationStatus: 'active', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'content.restore',
    targetType: 'content',
    targetId: postId,
    reason: null,
  }).catch(() => {});

  return {postId, moderationStatus: 'active'};
});
