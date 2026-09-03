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

export interface FollowersPage {
  items: PublicUser[];
  /** ISO timestamp of the oldest item in this page — pass as `cursor` for the next page. Present only when a further page is likely available. */
  nextCursor?: string;
}

/**
 * "Who follows me" — the same follows/{...} query notifyFollowers already
 * uses (where followingId == hostId), just paginated instead of fetched in
 * full. `follows` itself stays server-only (firestore.rules: allow read,
 * write: if false), so this is the only way any client ever sees a page of
 * it, same posture as searchUsers being the only way `users` gets searched.
 */
export async function getFollowers(hostId: string, cursor?: string, pageSize?: number): Promise<FollowersPage> {
  const limit = clampLimit(pageSize, 50, 30);

  let query = db.collection('follows').where('followingId', '==', hostId).orderBy('createdAt', 'desc').limit(limit);
  if (cursor) {
    query = query.startAfter(Timestamp.fromDate(new Date(cursor)));
  }

  const snap = await query.get();
  const followerIds = snap.docs.map((doc) => doc.data().followerId as string);
  const userSnaps = await Promise.all(followerIds.map((id) => db.collection('users').doc(id).get()));

  const items: PublicUser[] = userSnaps
    .filter((s) => s.exists)
    .map((s) => {
      const data = s.data()!;
      return {
        uid: s.id,
        username: (data.username as string) ?? null,
        displayName: (data.displayName as string) ?? null,
        photoURL: (data.photoURL as string) ?? null,
      };
    });

  const lastDoc = snap.docs[snap.docs.length - 1];
  const lastCreatedAt = lastDoc?.data().createdAt as Timestamp | undefined;

  return {
    items,
    nextCursor: snap.docs.length === limit && lastCreatedAt ? lastCreatedAt.toDate().toISOString() : undefined,
  };
}
