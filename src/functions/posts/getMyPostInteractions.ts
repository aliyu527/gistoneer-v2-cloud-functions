import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getMyPostInteractions as getMyPostInteractionsService, type PostInteractionState} from '../../posts/interactions';

const MAX_POST_IDS = 50;

interface GetMyPostInteractionsRequest {
  postIds: string[];
}

export const getMyPostInteractions = onCall<GetMyPostInteractionsRequest, Promise<Record<string, PostInteractionState>>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const postIds = request.data?.postIds;
    if (!Array.isArray(postIds) || postIds.some((id) => typeof id !== 'string')) {
      throw new HttpsError('invalid-argument', 'Missing post references.');
    }

    return getMyPostInteractionsService(request.auth.uid, postIds.slice(0, MAX_POST_IDS));
  },
);
