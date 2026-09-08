import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminUserListItem {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'suspended';
  emailVerified: boolean;
  phoneVerified: boolean;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  createdAt: string | null;
}

interface AdminListUsersRequest {
  status?: 'active' | 'suspended';
  verified?: boolean;
  isVerified?: boolean;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListUsersResponse {
  users: AdminUserListItem[];
  nextCursor: string | null;
}

function toListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminUserListItem {
  const data = doc.data();
  const createdAt = data.createdAt;
  return {
    uid: doc.id,
    username: (data.username as string) ?? null,
    displayName: (data.displayName as string) ?? null,
    photoURL: (data.photoURL as string) ?? null,
    email: (data.email as string) ?? null,
    phone: (data.phone as string) ?? null,
    // Every existing user doc predates this field — treat a missing value as
    // 'active' rather than excluding legacy users from the default view.
    status: (data.status as AdminUserListItem['status']) ?? 'active',
    emailVerified: Boolean(data.emailVerified),
    phoneVerified: Boolean(data.phoneVerified),
    isVerified: Boolean(data.isVerified),
    followerCount: typeof data.followerCount === 'number' ? data.followerCount : 0,
    followingCount: typeof data.followingCount === 'number' ? data.followingCount : 0,
    createdAt: createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Paginated, filterable admin user list — server-brokered since `users` is
 * owner-only-read by rule. Cursor-based (startAfter), never a full-collection
 * scan. Sorted by `createdAt` only (not `followerCount`): interactions.ts's
 * getSuggestedUsers already documents why — followerCount is only ever set
 * the first time someone receives a follow, so Firestore's orderBy would
 * silently exclude every user who's never been followed. createdAt is set
 * via serverTimestamp() for every user at signup, so it can never do that.
 * `status`/`verified` filters need composite indexes (see
 * firestore.indexes.json); the unfiltered case needs none (single-field,
 * auto-indexed). `isVerified` (the platform verification flag, unrelated to
 * `verified`/emailVerified) is deliberately mutually exclusive with
 * `status`/`verified` here rather than combinable with them — combining
 * would need a 3-field composite index; keeping it a standalone alternative
 * needs only one more 2-field index, the same discipline used by every
 * other filtered list function since Module 14's audit log viewer.
 */
export const adminListUsers = onCall<AdminListUsersRequest, Promise<AdminListUsersResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'users.read');

  const {status, verified, isVerified, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('users');
  if (isVerified !== undefined) {
    q = q.where('isVerified', '==', isVerified);
  } else {
    if (status) {
      q = q.where('status', '==', status);
    }
    if (verified === true) {
      q = q.where('emailVerified', '==', true);
    }
  }
  q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('users').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const users = snap.docs.map(toListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {users, nextCursor};
});
