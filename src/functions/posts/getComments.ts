import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getComments as getCommentsService, type PostComment} from '../../posts/comments';
import {clampLimit} from '../../lib/pagination';

interface GetCommentsRequest {
  postId: string;
  limit?: number;
}

export const getComments = onCall<GetCommentsRequest, Promise<PostComment[]>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }

  return getCommentsService(postId, clampLimit(request.data?.limit, 50, 50));
});
