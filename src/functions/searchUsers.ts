import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {enforceRateLimit} from '../lib/rateLimit';
import {clampLimit} from '../lib/pagination';

interface SearchUsersRequest {
  query: string;
  limit?: number;
}

interface PublicUser {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
}

// Same charset as normalizeUsername (lib/normalize.ts) but without requiring
// a full 3-20 char valid username - a search prefix like "al" is legitimate
// and shorter than any real username.
function normalizeSearchQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 50);
}

// Standard Firestore prefix-range trick: this is the highest code point in
// the Unicode Basic Multilingual Plane's private-use area, so appending it
// to the query string produces an upper bound that matches every value
// starting with that prefix.
const PREFIX_RANGE_SUFFIX = String.fromCharCode(0xf8ff);

/**
 * The one real user-search capability in this app - everything else
 * (Find Friends, Chat, Search screens) is unwired dummy UI. Server-brokered
 * (client never queries `users` directly - that collection's rule is
 * owner-only read), prefix range query on usernameLower (already a field on
 * every user doc, see Store/AuthProvider.tsx's UserProfile), rate-limited
 * and capped the same way every other discovery-style endpoint in this app
 * is (Module 10/13 precedent). Returns only public-safe fields - never
 * email/phone.
 */
export const searchUsers = onCall<SearchUsersRequest, Promise<PublicUser[]>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;
  await enforceRateLimit(uid, 'searchUsers', {maxPerWindow: 60, windowMs: 10 * 60 * 1000});

  const rawQuery = request.data?.query;
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const q = normalizeSearchQuery(rawQuery);
  if (q.length === 0) {
    return [];
  }

  const limit = clampLimit(request.data?.limit, 20, 10);

  const snap = await db
    .collection('users')
    .where('usernameLower', '>=', q)
    .where('usernameLower', '<', q + PREFIX_RANGE_SUFFIX)
    .limit(limit)
    .get();

  return snap.docs
    .filter((doc) => doc.id !== uid)
    .map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        username: (data.username as string) ?? null,
        displayName: (data.displayName as string) ?? null,
        photoURL: (data.photoURL as string) ?? null,
      };
    });
});
