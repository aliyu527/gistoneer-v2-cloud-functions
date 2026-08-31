import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {likeComment as likeCommentService} from '../../posts/commentInteractions';

interface LikeCommentRequest {
  postId: string;
  commentId: string;
}

export const likeComment = onCall<LikeCommentRequest, Promise<{liked: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId, commentId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0 || typeof commentId !== 'string' || commentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing comment reference.');
  }

  await likeCommentService(request.auth.uid, postId, commentId);
  return {liked: true};
});
