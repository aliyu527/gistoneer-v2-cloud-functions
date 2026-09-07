import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface RestoreCommentRequest {
  postId: string;
  commentId: string;
}

interface RestoreCommentResponse {
  commentId: string;
  moderationStatus: 'active';
}

export const restoreComment = onCall<RestoreCommentRequest, Promise<RestoreCommentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'content.moderate');

  const postId = request.data?.postId;
  const commentId = request.data?.commentId;
  if (typeof postId !== 'string' || postId.length === 0 || typeof commentId !== 'string' || commentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing comment reference.');
  }

  const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) {
    throw new HttpsError('not-found', 'This comment could not be found.');
  }

  await commentRef.update({moderationStatus: 'active', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'comment.restore',
    targetType: 'comment',
    targetId: commentId,
    reason: null,
  }).catch(() => {});

  return {commentId, moderationStatus: 'active'};
});
