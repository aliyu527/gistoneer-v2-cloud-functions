import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toContentListItem, type AdminContentListItem} from './adminContentShared';

interface AdminGetPostsUsingSoundRequest {
  soundId: string;
  pageSize?: number;
  cursor?: string;
}

interface AdminGetPostsUsingSoundResponse {
  posts: AdminContentListItem[];
  nextCursor: string | null;
}

/**
 * Paginated across ALL audiences (not just public) — an admin reviewing a
 * sound's usage before hiding/removing it needs the full picture, unlike the
 * mobile app's own soundTrackIds-backed feature which only ever shows public
 * posts. Needs its own composite index (soundTrackIds CONTAINS, createdAt
 * DESC) without the audience field the existing index requires.
 */
export const adminGetPostsUsingSound = onCall<AdminGetPostsUsingSoundRequest, Promise<AdminGetPostsUsingSoundResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    await requireActiveAdmin(request, 'sounds.read');

    const soundId = request.data?.soundId;
    if (typeof soundId !== 'string' || soundId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing soundId.');
    }
    const pageSize = clampLimit(request.data?.pageSize, 50, 20);
    const cursor = request.data?.cursor;

    let q = db.collection('posts').where('soundTrackIds', 'array-contains', soundId).orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('posts').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const posts = snap.docs.map(toContentListItem);
    const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

    return {posts, nextCursor};
  },
);
