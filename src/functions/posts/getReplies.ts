import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getReplies as getRepliesService, type PostComment} from '../../posts/comments';
import {clampLimit} from '../../lib/pagination';

interface GetRepliesRequest {
  postId: string;
  commentId: string;
  limit?: number;
}

export const getReplies = onCall<GetRepliesRequest, Promise<PostComment[]>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId, commentId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }
  if (typeof commentId !== 'string' || commentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing comment reference.');
  }

  return getRepliesService(postId, commentId, clampLimit(request.data?.limit, 20, 20));
});
