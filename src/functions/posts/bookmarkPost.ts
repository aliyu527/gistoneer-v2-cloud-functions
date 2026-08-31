import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {bookmarkPost as bookmarkPostService} from '../../posts/interactions';

interface BookmarkPostRequest {
  postId: string;
}

export const bookmarkPost = onCall<BookmarkPostRequest, Promise<{bookmarked: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {postId} = request.data ?? {};
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing post reference.');
  }

  await bookmarkPostService(request.auth.uid, postId);
  return {bookmarked: true};
});
