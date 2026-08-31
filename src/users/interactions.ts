import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {createNotification} from '../notifications/service';

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
