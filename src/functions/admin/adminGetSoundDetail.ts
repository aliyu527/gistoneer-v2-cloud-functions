import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminSoundListItem, SoundModerationStatus} from './adminListSounds';

interface SoundTechnicalMetadata {
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  codec: string | null;
}

export interface AdminSoundDetail extends AdminSoundListItem {
  description: string | null;
  originalFileName: string | null;
  mimeType: string;
  extension: string;
  size: number;
  technicalMetadata: SoundTechnicalMetadata | null;
  updatedAt: string | null;
  usageCount: number;
  creatorStatus: 'active' | 'suspended' | null;
  lastModeration: {action: 'sound.hide' | 'sound.remove'; reason: string | null; at: string | null; byEmail: string | null} | null;
}

interface AdminGetSoundDetailRequest {
  soundId: string;
}

/**
 * Full admin sound record. usageCount is a plain array-contains count() with
 * no other filter — Firestore doesn't require a composite index for that,
 * unlike the paginated posts-using-this-sound list (adminGetPostsUsingSound),
 * which does.
 */
export const adminGetSoundDetail = onCall<AdminGetSoundDetailRequest, Promise<AdminSoundDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const soundId = request.data?.soundId;
  if (typeof soundId !== 'string' || soundId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing soundId.');
  }

  const snap = await db.collection('sounds').doc(soundId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This sound could not be found.');
  }
  const data = snap.data()!;
  const ownerId = (data.ownerId as string) ?? '';
  const moderationStatus = (data.moderationStatus as SoundModerationStatus) ?? 'active';

  const [creatorSnap, usageSnap, lastModerationSnap] = await Promise.all([
    db.collection('users').doc(ownerId).get(),
    db.collection('posts').where('soundTrackIds', 'array-contains', soundId).count().get(),
    moderationStatus !== 'active'
      ? db.collection('adminAuditLogs').where('targetId', '==', soundId).where('targetType', '==', 'sound').orderBy('createdAt', 'desc').limit(1).get()
      : Promise.resolve(null),
  ]);

  let creator: AdminSoundDetail['creator'] = {userId: ownerId, username: null, displayName: null, avatarUrl: null};
  let creatorStatus: AdminSoundDetail['creatorStatus'] = null;
  if (creatorSnap.exists) {
    const creatorData = creatorSnap.data()!;
    creator = {
      userId: ownerId,
      username: (creatorData.username as string) ?? null,
      displayName: (creatorData.displayName as string) ?? null,
      avatarUrl: (creatorData.photoURL as string) ?? null,
    };
    creatorStatus = (creatorData.status as 'active' | 'suspended') ?? 'active';
  }

  let lastModeration: AdminSoundDetail['lastModeration'] = null;
  if (lastModerationSnap && !lastModerationSnap.empty) {
    const entry = lastModerationSnap.docs[0].data();
    lastModeration = {
      action: entry.action as 'sound.hide' | 'sound.remove',
      reason: (entry.reason as string) ?? null,
      at: entry.createdAt?.toDate?.().toISOString() ?? null,
      byEmail: (entry.actorEmail as string) ?? null,
    };
  }

  const tech = data.technicalMetadata as Record<string, unknown> | undefined;

  return {
    id: snap.id,
    ownerId,
    creator,
    title: (data.title as string) ?? 'Untitled Sound',
    artist: (data.artist as string) ?? null,
    album: (data.album as string) ?? null,
    genre: (data.genre as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    audioUrl: (data.audioUrl as string) ?? '',
    durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
    visibility: (data.visibility as AdminSoundListItem['visibility']) ?? 'public',
    moderationStatus,
    source: (data.source as AdminSoundListItem['source']) ?? 'user_upload',
    categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds : [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    description: (data.description as string) ?? null,
    originalFileName: (data.originalFileName as string) ?? null,
    mimeType: (data.mimeType as string) ?? '',
    extension: (data.extension as string) ?? '',
    size: typeof data.size === 'number' ? data.size : 0,
    technicalMetadata: tech
      ? {
          bitrateKbps: typeof tech.bitrateKbps === 'number' ? tech.bitrateKbps : null,
          sampleRateHz: typeof tech.sampleRateHz === 'number' ? tech.sampleRateHz : null,
          channels: typeof tech.channels === 'number' ? tech.channels : null,
          codec: (tech.codec as string) ?? null,
        }
      : null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    usageCount: usageSnap.data().count,
    creatorStatus,
    lastModeration,
  };
});
