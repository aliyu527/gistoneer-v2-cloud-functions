import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getMyCommentInteractions as getMyCommentInteractionsService} from '../../posts/commentInteractions';

const MAX_COMMENT_IDS = 100;

interface GetMyCommentInteractionsRequest {
  commentIds: string[];
}

export const getMyCommentInteractions = onCall<GetMyCommentInteractionsRequest, Promise<Record<string, boolean>>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const commentIds = request.data?.commentIds;
    if (!Array.isArray(commentIds) || commentIds.some((id) => typeof id !== 'string')) {
      throw new HttpsError('invalid-argument', 'Missing comment references.');
    }

    return getMyCommentInteractionsService(request.auth.uid, commentIds.slice(0, MAX_COMMENT_IDS));
  },
);
