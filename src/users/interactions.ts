import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {createNotification} from '../notifications/service';
import {clampLimit} from '../lib/pagination';

/**
 * Mirrors posts/interactions.ts's likePost/unlikePost exactly: a doc keyed
 * `{followerId}_{followingId}` for idempotent create/delete (existence
 * checked, not transactional — same accepted-risk posture as that
 * precedent) plus FieldValue.increment on both sides' denormalized counts
 * (users/{uid}.followerCount / .followingCount), so reading either count
 * never requires scanning follows itself.
 */
export async function followUser(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) {
    throw new HttpsError('invalid-argument', "You can't follow yourself.");
  }
  const targetSnap = await db.collection('users').doc(followingId).get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', "We couldn't find that user.");
  }

  const ref = db.collection('follows').doc(`${followerId}_${followingId}`);
  const existing = await ref.get();
  if (existing.exists) return;

  await ref.set({followerId, followingId, createdAt: FieldValue.serverTimestamp()});
  await db.collection('users').doc(followingId).update({followerCount: FieldValue.increment(1)});
  await db.collection('users').doc(followerId).update({followingCount: FieldValue.increment(1)});
  await createNotification({recipientId: followingId, actorId: followerId, type: 'follow'});
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const ref = db.collection('follows').doc(`${followerId}_${followingId}`);
  const existing = await ref.get();
  if (!existing.exists) return;

  await ref.delete();
  await db.collection('users').doc(followingId).update({followerCount: FieldValue.increment(-1)});
  await db.collection('users').doc(followerId).update({followingCount: FieldValue.increment(-1)});
}

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const snap = await db.collection('follows').doc(`${followerId}_${followingId}`).get();
  return snap.exists;
}

interface PublicUser {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface SuggestedUser extends PublicUser {
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
}

export interface SuggestedUsersPage {
  items: SuggestedUser[];
  /** ISO timestamp of the oldest item in this page — pass as `cursor` for the next page. Present only when a further page is likely available. */
  nextCursor?: string;
}

/**
 * "People" tab's browsable default (Discover) — no separate suggestion/ML
 * system. Ranked by `createdAt` (newest first), NOT `followerCount`:
 * confirmed against real Firestore data that followerCount is only ever
 * set the first time someone receives a follow (FieldValue.increment in
 * followUser above never runs otherwise), so a brand-new app where nobody
 * has been followed yet has NO users with that field set at all — and
 * Firestore's orderBy silently excludes every document missing the
 * ordered field, which returned zero results for two real registered
 * users. `createdAt` is set by FieldValue.serverTimestamp() for every
 * user at signup, so this can never silently exclude anyone. Self
 * excluded after the query (same posture as searchUsers), so a page can
 * come back shorter than requested — accepted, same precedent.
 * isFollowing is computed via the same deterministic-id `isFollowing`
 * lookup getUserProfile already uses, one read per candidate.
 */
export async function getSuggestedUsers(viewerUid: string, cursor?: string, pageSize?: number): Promise<SuggestedUsersPage> {
  const limit = clampLimit(pageSize, 50, 30);

  let query = db.collection('users').orderBy('createdAt', 'desc').limit(limit);
  if (cursor) {
    query = query.startAfter(Timestamp.fromDate(new Date(cursor)));
  }

  const snap = await query.get();
  const items: SuggestedUser[] = await Promise.all(
    snap.docs
      .filter((doc) => doc.id !== viewerUid)
      .map(async (doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          username: (data.username as string) ?? null,
          displayName: (data.displayName as string) ?? null,
          photoURL: (data.photoURL as string) ?? null,
          followerCount: (data.followerCount as number) ?? 0,
          followingCount: (data.followingCount as number) ?? 0,
          isFollowing: await isFollowing(viewerUid, doc.id),
        };
      }),
  );

  const lastDoc = snap.docs[snap.docs.length - 1];
  const lastCreatedAt = lastDoc?.data().createdAt as Timestamp | undefined;

  return {
    items,
    nextCursor: snap.docs.length === limit && lastCreatedAt ? lastCreatedAt.toDate().toISOString() : undefined,
  };
}

export interface FollowersPage {
  items: SuggestedUser[];
  /** ISO timestamp of the oldest item in this page — pass as `cursor` for the next page. Present only when a further page is likely available. */
  nextCursor?: string;
}

async function hydrateUsers(uids: string[], viewerUid: string): Promise<SuggestedUser[]> {
  const userSnaps = await Promise.all(uids.map((id) => db.collection('users').doc(id).get()));
  return Promise.all(
    userSnaps
      .filter((s) => s.exists)
      .map(async (s) => {
        const data = s.data()!;
        return {
          uid: s.id,
          username: (data.username as string) ?? null,
          displayName: (data.displayName as string) ?? null,
          photoURL: (data.photoURL as string) ?? null,
          followerCount: (data.followerCount as number) ?? 0,
          followingCount: (data.followingCount as number) ?? 0,
          isFollowing: await isFollowing(viewerUid, s.id),
        };
      }),
  );
}

/**
 * "Who follows hostId" — the same follows/{...} query notifyFollowers
 * already uses (where followingId == hostId), just paginated instead of
 * fetched in full. `follows` itself stays server-only (firestore.rules:
 * allow read, write: if false), so this is the only way any client ever
 * sees a page of it, same posture as searchUsers being the only way
 * `users` gets searched. `hostId` (whose followers) and `viewerUid`
 * (whose isFollowing perspective) are separate — viewing someone else's
 * followers list shows YOUR follow relationship to each of them, not
 * theirs.
 */
export async function getFollowers(hostId: string, viewerUid: string, cursor?: string, pageSize?: number): Promise<FollowersPage> {
  const limit = clampLimit(pageSize, 50, 30);

  let query = db.collection('follows').where('followingId', '==', hostId).orderBy('createdAt', 'desc').limit(limit);
  if (cursor) {
    query = query.startAfter(Timestamp.fromDate(new Date(cursor)));
  }

  const snap = await query.get();
  const items = await hydrateUsers(
    snap.docs.map((doc) => doc.data().followerId as string),
    viewerUid,
  );

  const lastDoc = snap.docs[snap.docs.length - 1];
  const lastCreatedAt = lastDoc?.data().createdAt as Timestamp | undefined;

  return {
    items,
    nextCursor: snap.docs.length === limit && lastCreatedAt ? lastCreatedAt.toDate().toISOString() : undefined,
  };
}

/**
 * "Who hostId follows" — the mirror image of getFollowers, querying
 * `followerId == hostId` and resolving the `followingId` side instead.
 * Same pagination/hydration shape.
 */
export async function getFollowing(hostId: string, viewerUid: string, cursor?: string, pageSize?: number): Promise<FollowersPage> {
  const limit = clampLimit(pageSize, 50, 30);

  let query = db.collection('follows').where('followerId', '==', hostId).orderBy('createdAt', 'desc').limit(limit);
  if (cursor) {
    query = query.startAfter(Timestamp.fromDate(new Date(cursor)));
  }

  const snap = await query.get();
  const items = await hydrateUsers(
    snap.docs.map((doc) => doc.data().followingId as string),
    viewerUid,
  );

  const lastDoc = snap.docs[snap.docs.length - 1];
  const lastCreatedAt = lastDoc?.data().createdAt as Timestamp | undefined;

  return {
    items,
    nextCursor: snap.docs.length === limit && lastCreatedAt ? lastCreatedAt.toDate().toISOString() : undefined,
  };
}
