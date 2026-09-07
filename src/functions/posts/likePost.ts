import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {likePost as likePostService} from '../../posts/interactions';
import {enforceRateLimit} from '../../lib/rateLimit';

interface LikePostRequest {
  postId: string;
}

export const likePost = onCall<LikePostRequest, Promise<{liked: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }

  await enforceRateLimit(request.auth.uid, 'likePost', {maxPerWindow: 60, windowMs: 10 * 60 * 1000});
  await likePostService(request.auth.uid, postId);
  return {liked: true};
});
