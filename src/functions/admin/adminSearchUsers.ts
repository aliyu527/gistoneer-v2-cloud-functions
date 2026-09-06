import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import type {AdminUserListItem} from './adminListUsers';

interface AdminSearchUsersRequest {
  query: string;
}

interface AdminSearchUsersResponse {
  users: AdminUserListItem[];
}

const SEARCH_LIMIT = 20;
const UID_SHAPE = /^[A-Za-z0-9]{20,36}$/;
const PHONE_SHAPE = /^\+?[0-9]{7,15}$/;
// Same Firestore prefix-range trick as functions/src/functions/searchUsers.ts.
const PREFIX_RANGE_SUFFIX = String.fromCharCode(0xf8ff);

function normalizeUsernameQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 50);
}

function toListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminUserListItem {
  const data = doc.data();
  return {
    uid: doc.id,
    username: (data.username as string) ?? null,
    displayName: (data.displayName as string) ?? null,
    photoURL: (data.photoURL as string) ?? null,
    email: (data.email as string) ?? null,
    phone: (data.phone as string) ?? null,
    status: (data.status as AdminUserListItem['status']) ?? 'active',
    emailVerified: Boolean(data.emailVerified),
    phoneVerified: Boolean(data.phoneVerified),
    followerCount: typeof data.followerCount === 'number' ? data.followerCount : 0,
    followingCount: typeof data.followingCount === 'number' ? data.followingCount : 0,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Admin-only search — distinct from the public, rate-limited, public-fields-
 * only `searchUsers` callable (that one is for the mobile app's Find
 * Friends/Chat surfaces and must never leak email/phone). This one exposes
 * full admin fields and needs no rate limit (admin-only, not a public scan
 * surface). Tries, in order: exact uid, exact email, exact phone, then falls
 * back to the same usernameLower prefix-range query searchUsers.ts uses —
 * Firestore has no native substring/multi-field search.
 */
export const adminSearchUsers = onCall<AdminSearchUsersRequest, Promise<AdminSearchUsersResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  if (UID_SHAPE.test(trimmed)) {
    const snap = await db.collection('users').doc(trimmed).get();
    if (snap.exists) {
      return {users: [toListItem(snap as FirebaseFirestore.QueryDocumentSnapshot)]};
    }
  }

  if (trimmed.includes('@')) {
    const snap = await db.collection('users').where('email', '==', trimmed.toLowerCase()).limit(SEARCH_LIMIT).get();
    if (!snap.empty) {
      return {users: snap.docs.map(toListItem)};
    }
  }

  const digitsOnly = trimmed.replace(/[\s-]/g, '');
  if (PHONE_SHAPE.test(digitsOnly)) {
    const snap = await db.collection('users').where('phone', '==', digitsOnly).limit(SEARCH_LIMIT).get();
    if (!snap.empty) {
      return {users: snap.docs.map(toListItem)};
    }
  }

  const q = normalizeUsernameQuery(trimmed);
  if (q.length === 0) {
    return {users: []};
  }

  const snap = await db
    .collection('users')
    .where('usernameLower', '>=', q)
    .where('usernameLower', '<', q + PREFIX_RANGE_SUFFIX)
    .limit(SEARCH_LIMIT)
    .get();

  return {users: snap.docs.map(toListItem)};
});
