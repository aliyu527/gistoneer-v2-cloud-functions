import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {createNotification} from '../notifications/service';
import {agoraUidFor} from './agoraUid';

const FOLLOWER_NOTIFY_BATCH_SIZE = 400; // headroom under Firestore's 500-write batch limit
const MAX_SPEAKERS = 4; // concurrent approved speakers, enforced in approveSpeaker — Brekete (the reference) has no cap at all

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
  // Denormalized so every viewer's existing liveSessions listener knows
  // which remote uid is the host (vs. a co-host speaker) without a second
  // lookup — needed once more than one uid can ever be publishing.
  await ref.update({
    status: 'live',
    hostAgoraUid: agoraUidFor(hostId),
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
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

interface LiveSpeaker {
  uid: string;
  agoraUid: number;
  displayName: string;
  photoURL?: string;
}

/**
 * Must already be an audience member (presence doc exists — every viewer
 * gets one via joinAudience/getLiveToken('audience') before they could ever
 * see a "request to speak" button). Denormalizes displayName/photoURL the
 * same buildActor-style way notifications/service.ts already does, so the
 * host's request-queue UI never needs a second read per requester.
 */
export async function requestToSpeak(uid: string, liveId: string): Promise<void> {
  const liveRef = db.collection('liveSessions').doc(liveId);
  const liveSnap = await liveRef.get();
  if (!liveSnap.exists || liveSnap.data()!.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This live is no longer available.');
  }

  const presenceRef = liveRef.collection('audience').doc(uid);
  const presenceSnap = await presenceRef.get();
  if (!presenceSnap.exists) {
    throw new HttpsError('failed-precondition', "You're not watching this live.");
  }
  const speakStatus = presenceSnap.data()!.speakStatus;
  if (speakStatus === 'requested' || speakStatus === 'approved') return; // idempotent

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() ?? {};

  await presenceRef.update({
    speakStatus: 'requested',
    requestedAt: FieldValue.serverTimestamp(),
    displayName: (user.displayName as string) || (user.username as string) || 'Gistoneer user',
    ...(user.photoURL ? {photoURL: user.photoURL} : {}),
  });
}

export async function cancelSpeakRequest(uid: string, liveId: string): Promise<void> {
  const presenceRef = db.collection('liveSessions').doc(liveId).collection('audience').doc(uid);
  const snap = await presenceRef.get();
  if (!snap.exists || snap.data()!.speakStatus !== 'requested') return;
  await presenceRef.update({speakStatus: 'none'});
}

async function updateActiveSpeakers(liveId: string, mutate: (speakers: LiveSpeaker[]) => LiveSpeaker[]): Promise<LiveSpeaker[]> {
  const ref = db.collection('liveSessions').doc(liveId);
  const snap = await ref.get();
  const current = ((snap.data()?.activeSpeakers as LiveSpeaker[] | undefined) ?? []).slice();
  const next = mutate(current);
  await ref.update({activeSpeakers: next, updatedAt: FieldValue.serverTimestamp()});
  return next;
}

/** Host-only. Rejects once MAX_SPEAKERS are already approved — Brekete has no such cap. */
export async function approveSpeaker(hostId: string, liveId: string, targetUid: string): Promise<void> {
  const {ref} = await getOwnedLiveSession(hostId, liveId);
  const presenceRef = ref.collection('audience').doc(targetUid);
  const presenceSnap = await presenceRef.get();
  if (!presenceSnap.exists || presenceSnap.data()!.speakStatus !== 'requested') {
    throw new HttpsError('failed-precondition', 'That request is no longer pending.');
  }

  const agoraUid = agoraUidFor(targetUid);
  const displayName = (presenceSnap.data()!.displayName as string) ?? 'Gistoneer user';
  const photoURL = presenceSnap.data()!.photoURL as string | undefined;

  await updateActiveSpeakers(liveId, (speakers) => {
    if (speakers.length >= MAX_SPEAKERS) {
      throw new HttpsError('failed-precondition', 'This live already has the maximum number of speakers.');
    }
    return [...speakers, {uid: targetUid, agoraUid, displayName, ...(photoURL ? {photoURL} : {})}];
  });

  await presenceRef.update({
    speakStatus: 'approved',
    respondedAt: FieldValue.serverTimestamp(),
    agoraUid,
    audioMuted: false,
    videoMuted: false,
  });
}

/** Host-only. */
export async function denySpeaker(hostId: string, liveId: string, targetUid: string): Promise<void> {
  const {ref} = await getOwnedLiveSession(hostId, liveId);
  const presenceRef = ref.collection('audience').doc(targetUid);
  const presenceSnap = await presenceRef.get();
  if (!presenceSnap.exists || presenceSnap.data()!.speakStatus !== 'requested') return;
  await presenceRef.update({speakStatus: 'none', respondedAt: FieldValue.serverTimestamp()});
}

/** Allowed for the host (removing someone) or the speaker themselves (stepping down). */
export async function removeSpeaker(callerId: string, liveId: string, targetUid: string): Promise<void> {
  const ref = db.collection('liveSessions').doc(liveId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', "We couldn't find that live session.");
  }
  if (snap.data()!.hostId !== callerId && callerId !== targetUid) {
    throw new HttpsError('permission-denied', "You can't remove this speaker.");
  }

  await updateActiveSpeakers(liveId, (speakers) => speakers.filter((s) => s.uid !== targetUid));

  const presenceRef = ref.collection('audience').doc(targetUid);
  const presenceSnap = await presenceRef.get();
  if (presenceSnap.exists) {
    await presenceRef.update({speakStatus: 'none', audioMuted: true, videoMuted: true});
  }
}
