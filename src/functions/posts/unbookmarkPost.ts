import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unbookmarkPost as unbookmarkPostService} from '../../posts/interactions';

interface UnbookmarkPostRequest {
  postId: string;
}

export const unbookmarkPost = onCall<UnbookmarkPostRequest, Promise<{bookmarked: false}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {postId} = request.data ?? {};
    if (typeof postId !== 'string' || postId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing post reference.');
    }

    await unbookmarkPostService(request.auth.uid, postId);
    return {bookmarked: false};
  },
);
