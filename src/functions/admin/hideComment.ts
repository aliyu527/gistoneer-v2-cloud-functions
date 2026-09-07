import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface HideCommentRequest {
  postId: string;
  commentId: string;
  reason: string;
}

interface HideCommentResponse {
  commentId: string;
  moderationStatus: 'hidden';
}

/**
 * Comments had zero moderation mechanism before Module 10 (no
 * moderationStatus field, no admin function) — this mirrors hideContent.ts
 * exactly, just scoped to the posts/{postId}/comments/{commentId}
 * subcollection. Enforcement is getComments/getReplies' own in-memory
 * filter (see posts/comments.ts) rather than a Firestore rule, since
 * comments are never read via direct client queries.
 */
export const hideComment = onCall<HideCommentRequest, Promise<HideCommentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'content.moderate');

  const postId = request.data?.postId;
  const commentId = request.data?.commentId;
  const reason = request.data?.reason;
  if (typeof postId !== 'string' || postId.length === 0 || typeof commentId !== 'string' || commentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing comment reference.');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) {
    throw new HttpsError('not-found', 'This comment could not be found.');
  }

  await commentRef.update({moderationStatus: 'hidden', updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: commentSnap.data()!.authorId as string,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'comment_hidden',
    postId,
    commentId,
    reason: reason.trim(),
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'comment.hide',
    targetType: 'comment',
    targetId: commentId,
    reason: reason.trim(),
  }).catch(() => {});

  return {commentId, moderationStatus: 'hidden'};
});
