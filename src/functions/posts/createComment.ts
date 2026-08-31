import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {createComment as createCommentService, type PostComment} from '../../posts/comments';

interface CreateCommentRequest {
  postId: string;
  text: string;
  parentCommentId?: string;
}

export const createComment = onCall<CreateCommentRequest, Promise<PostComment>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId, text, parentCommentId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }
  if (typeof text !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing comment text.');
  }
  if (parentCommentId !== undefined && (typeof parentCommentId !== 'string' || parentCommentId.length === 0)) {
    throw new HttpsError('invalid-argument', 'Invalid parent comment reference.');
  }

  return createCommentService(request.auth.uid, postId, text, parentCommentId ?? null);
});
