import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminPlaylistListItem} from './adminListPlaylists';

const CATALOG_SOUND_ID_PREFIX = 'catalog:';

export interface AdminPlaylistTrack {
  soundId: string;
  isCatalogTrack: boolean;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
}

export interface AdminPlaylistDetail extends AdminPlaylistListItem {
  creatorStatus: 'active' | 'suspended' | null;
  tracks: AdminPlaylistTrack[];
}

interface AdminGetPlaylistDetailRequest {
  playlistId: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Resolves `soundIds` (an ordered, mixed array of bare library-sound doc ids
 * and `catalog:`-prefixed ids) in the original stored order — never
 * re-sorted. Catalog entries are labeled "Catalog track" with no further
 * lookup, since the catalog is a static mock provider with no real Firestore
 * data (confirmed by audit) — nothing to resolve.
 */
export const adminGetPlaylistDetail = onCall<AdminGetPlaylistDetailRequest, Promise<AdminPlaylistDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const playlistId = request.data?.playlistId;
  if (typeof playlistId !== 'string' || playlistId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing playlistId.');
  }

  const snap = await db.collection('playlists').doc(playlistId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This playlist could not be found.');
  }
  const data = snap.data()!;
  const ownerId = (data.ownerId as string) ?? '';
  const soundIds: string[] = Array.isArray(data.soundIds) ? (data.soundIds as string[]) : [];

  const libraryIds = soundIds.filter((id) => !id.startsWith(CATALOG_SOUND_ID_PREFIX));
  const [creatorSnap, ...soundBatches] = await Promise.all([
    db.collection('users').doc(ownerId).get(),
    ...chunk([...new Set(libraryIds)], 10).map((batch) => db.collection('sounds').where('__name__', 'in', batch).get()),
  ]);

  const soundMap = new Map<string, FirebaseFirestore.DocumentData>();
  for (const batchSnap of soundBatches) {
    for (const doc of batchSnap.docs) {
      soundMap.set(doc.id, doc.data());
    }
  }

  const tracks: AdminPlaylistTrack[] = soundIds.map((id) => {
    if (id.startsWith(CATALOG_SOUND_ID_PREFIX)) {
      return {soundId: id, isCatalogTrack: true, title: null, artist: null, artworkUrl: null, durationMs: null};
    }
    const sound = soundMap.get(id);
    return {
      soundId: id,
      isCatalogTrack: false,
      title: (sound?.title as string) ?? null,
      artist: (sound?.artist as string) ?? null,
      artworkUrl: (sound?.artworkUrl as string) ?? null,
      durationMs: typeof sound?.durationMs === 'number' ? sound.durationMs : null,
    };
  });

  let creator: AdminPlaylistDetail['creator'] = {userId: ownerId, username: null, displayName: null, avatarUrl: null};
  let creatorStatus: AdminPlaylistDetail['creatorStatus'] = null;
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

  return {
    id: snap.id,
    ownerId,
    creator,
    creatorStatus,
    name: (data.name as string) ?? 'Untitled Playlist',
    description: (data.description as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    trackCount: typeof data.trackCount === 'number' ? data.trackCount : soundIds.length,
    visibility: (data.visibility as AdminPlaylistDetail['visibility']) ?? 'private',
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    tracks,
  };
});
