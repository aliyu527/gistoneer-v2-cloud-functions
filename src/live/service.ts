import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {createNotification} from '../notifications/service';

const FOLLOWER_NOTIFY_BATCH_SIZE = 400; // headroom under Firestore's 500-write batch limit

interface CreateLiveSessionInput {
  title: string;
  visibility: 'public' | 'private';
}

/**
 * Denormalizes the host's name/avatar onto the session doc at creation time
 * — same posture as notifications/service.ts's buildActor (one user read,
 * cached onto the doc rather than re-joined on every feed render).
 */
export async function createLiveSession(hostId: string, {title, visibility}: CreateLiveSessionInput): Promise<string> {
  const hostSnap = await db.collection('users').doc(hostId).get();
  const host = hostSnap.data() ?? {};
  const hostName = (host.displayName as string) || (host.username as string) || 'Gistoneer user';

  const ref = db.collection('liveSessions').doc();
  await ref.set({
    hostId,
    hostName,
    ...(host.photoURL ? {hostAvatarUrl: host.photoURL} : {}),
    // Title is optional to the caller (spec: "do not make mandatory") — a
    // sensible fallback using the host's own name, not an empty string.
    title: title || `${hostName}'s Live`,
    visibility,
    status: 'starting',
    // The auto-generated doc id doubles as the Agora channel name — unique
    // by construction, never derived from anything user-identifying (spec's
    // explicit "never a username/email/phone as channel name").
    agoraChannelName: ref.id,
    viewerCount: 0,
    startedAt: null,
    endedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function getOwnedLiveSession(hostId: string, liveId: string) {
  const ref = db.collection('liveSessions').doc(liveId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', "We couldn't find that live session.");
  }
  if (snap.data()!.hostId !== hostId) {
    throw new HttpsError('permission-denied', "This isn't your live session.");
  }
  return {ref, data: snap.data()!};
}

/**
 * Only ever called after the host's Agora join has actually succeeded
 * client-side — a session that fails to connect never flips to 'live' and
 * therefore never appears in the public feed. Fans out a 'live' notification
 * to the host's followers here, inline (never a separate trigger), matching
 * likePost/followUser's established posture.
 */
export async function goLive(hostId: string, liveId: string): Promise<void> {
  const {ref} = await getOwnedLiveSession(hostId, liveId);
  await ref.update({status: 'live', startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
  await notifyFollowers(hostId, liveId);
}

async function notifyFollowers(hostId: string, liveId: string): Promise<void> {
  const followerIds: string[] = [];
  const snap = await db.collection('follows').where('followingId', '==', hostId).get();
  snap.docs.forEach((doc) => followerIds.push(doc.data().followerId as string));

  for (let i = 0; i < followerIds.length; i += FOLLOWER_NOTIFY_BATCH_SIZE) {
    const batch = followerIds.slice(i, i + FOLLOWER_NOTIFY_BATCH_SIZE);
    await Promise.all(batch.map((followerId) => createNotification({recipientId: followerId, actorId: hostId, type: 'live', liveId})));
  }
}

/** Idempotent — a host tapping "End Live" twice (double-tap, retry after a dropped response) is a no-op the second time. */
export async function endLiveSession(hostId: string, liveId: string): Promise<void> {
  const {ref, data} = await getOwnedLiveSession(hostId, liveId);
  if (data.status === 'ended') return;
  await ref.update({status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
}

/**
 * Mirrors postLikes' idempotent-create pattern via a subcollection instead
 * of a composite doc id (liveSessions/{liveId}/audience/{uid}) — a re-join
 * (app relaunch, token refresh) never double-counts viewerCount.
 */
export async function joinAudience(uid: string, liveId: string): Promise<void> {
  const ref = db.collection('liveSessions').doc(liveId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This live is no longer available.');
  }

  const presenceRef = ref.collection('audience').doc(uid);
  const existing = await presenceRef.get();
  if (existing.exists) return;

  await presenceRef.set({uid, joinedAt: FieldValue.serverTimestamp()});
  await ref.update({viewerCount: FieldValue.increment(1)});
}

/**
 * Called from every real client exit path (no heartbeat/TTL — a client
 * killed rather than backgrounded leaves its presence doc and count
 * un-decremented; accepted-risk drift, same posture this codebase's other
 * non-transactional counters already carry). Never tries to zero out
 * viewerCount on endLiveSession — the feed only ever shows status:'live'
 * sessions, so a stale count on an ended one is never surfaced.
 */
export async function leaveAudience(uid: string, liveId: string): Promise<void> {
  const ref = db.collection('liveSessions').doc(liveId);
  const presenceRef = ref.collection('audience').doc(uid);
  const existing = await presenceRef.get();
  if (!existing.exists) return;

  await presenceRef.delete();
  await ref.update({viewerCount: FieldValue.increment(-1)});
}
