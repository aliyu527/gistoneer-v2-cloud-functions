import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unlikeComment as unlikeCommentService} from '../../posts/commentInteractions';

interface UnlikeCommentRequest {
  postId: string;
  commentId: string;
}

export const unlikeComment = onCall<UnlikeCommentRequest, Promise<{liked: false}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId, commentId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0 || typeof commentId !== 'string' || commentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing comment reference.');
  }

  await unlikeCommentService(request.auth.uid, postId, commentId);
  return {liked: false};
});
