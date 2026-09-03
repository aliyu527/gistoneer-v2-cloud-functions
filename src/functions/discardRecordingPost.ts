import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';

interface DiscardRecordingPostRequest {
  postId: string;
}

/** The host's "no, don't post this" option on the review screen. Only ever operates on status:'draft' posts, same guard as publishRecordingPost. */
export const discardRecordingPost = onCall<DiscardRecordingPostRequest, Promise<{discarded: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {postId} = request.data ?? {};
    if (typeof postId !== 'string' || postId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing post reference.');
    }

    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return {discarded: true}; // already gone — idempotent
    const data = snap.data()!;
    if (data.authorId !== request.auth.uid) {
      throw new HttpsError('permission-denied', "This isn't your post.");
    }
    if (data.status !== 'draft') {
      throw new HttpsError('failed-precondition', "This post has already been published — it can't be discarded.");
    }

    await ref.delete();
    return {discarded: true};
  },
);
