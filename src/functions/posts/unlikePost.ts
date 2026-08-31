import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unlikePost as unlikePostService} from '../../posts/interactions';

interface UnlikePostRequest {
  postId: string;
}

export const unlikePost = onCall<UnlikePostRequest, Promise<{liked: false}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }

  await unlikePostService(request.auth.uid, postId);
  return {liked: false};
});
