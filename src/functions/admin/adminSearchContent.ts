import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toContentListItem, type AdminContentListItem} from './adminListContent';

interface AdminSearchContentRequest {
  query: string;
}

interface AdminSearchContentResponse {
  contents: AdminContentListItem[];
}

const SEARCH_LIMIT = 20;

function normalizeUsername(raw: string): string {
  return raw
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

/**
 * Admin-only content search. Firestore has no substring/full-text search
 * capability and nothing in this codebase adds one — so this deliberately
 * supports only the search modes that ARE real, efficient Firestore
 * queries: exact postId, exact hashtag (array-contains, already indexed),
 * or exact creator @username (resolved via the same usernameLower exact-
 * match pattern adminSearchUsers.ts uses, then that creator's posts). Free-
 * text caption search is NOT supported — never faked with a client-side
 * full-collection scan.
 */
export const adminSearchContent = onCall<AdminSearchContentRequest, Promise<AdminSearchContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'content.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const postSnap = await db.collection('posts').doc(trimmed).get();
  if (postSnap.exists && postSnap.data()?.status === 'published') {
    return {contents: [toContentListItem(postSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  if (trimmed.startsWith('#')) {
    const tag = trimmed.slice(1).trim().toLowerCase();
    if (tag.length === 0) return {contents: []};
    const snap = await db
      .collection('posts')
      .where('status', '==', 'published')
      .where('hashtags', 'array-contains', tag)
      .orderBy('createdAt', 'desc')
      .limit(SEARCH_LIMIT)
      .get();
    return {contents: snap.docs.map(toContentListItem)};
  }

  const username = normalizeUsername(trimmed);
  if (username.length === 0) return {contents: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {contents: []};

  const authorId = userSnap.docs[0].id;
  const snap = await db.collection('posts').where('status', '==', 'published').where('authorId', '==', authorId).orderBy('createdAt', 'desc').limit(SEARCH_LIMIT).get();
  return {contents: snap.docs.map(toContentListItem)};
});
