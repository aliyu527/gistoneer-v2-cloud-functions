import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminSoundCreator} from './adminListSounds';

export interface AdminPlaylistListItem {
  id: string;
  ownerId: string;
  creator: AdminSoundCreator;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  trackCount: number;
  visibility: 'public' | 'private';
  createdAt: string | null;
  updatedAt: string | null;
}

interface AdminListPlaylistsRequest {
  visibility?: 'public' | 'private';
  creatorId?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListPlaylistsResponse {
  playlists: AdminPlaylistListItem[];
  nextCursor: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function resolveCreators(ownerIds: string[]): Promise<Map<string, AdminSoundCreator>> {
  const uniqueIds = [...new Set(ownerIds)];
  const map = new Map<string, AdminSoundCreator>();
  const results = await Promise.all(chunk(uniqueIds, 10).map((batch) => db.collection('users').where('__name__', 'in', batch).get()));
  for (const snap of results) {
    for (const doc of snap.docs) {
      const data = doc.data();
      map.set(doc.id, {
        userId: doc.id,
        username: (data.username as string) ?? null,
        displayName: (data.displayName as string) ?? null,
        avatarUrl: (data.photoURL as string) ?? null,
      });
    }
  }
  return map;
}

function toPlaylistListItem(doc: FirebaseFirestore.QueryDocumentSnapshot, creators: Map<string, AdminSoundCreator>): AdminPlaylistListItem {
  const data = doc.data();
  const ownerId = (data.ownerId as string) ?? '';
  return {
    id: doc.id,
    ownerId,
    creator: creators.get(ownerId) ?? {userId: ownerId, username: null, displayName: null, avatarUrl: null},
    name: (data.name as string) ?? 'Untitled Playlist',
    description: (data.description as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    trackCount: typeof data.trackCount === 'number' ? data.trackCount : 0,
    visibility: (data.visibility as AdminPlaylistListItem['visibility']) ?? 'private',
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Read-only — no moderation actions exist for playlists (no
 * playlists.moderate-equivalent permission exists or is signaled anywhere).
 * Sorted by `updatedAt` (not `createdAt`) to match the existing
 * (ownerId,updatedAt) / (visibility,updatedAt) indexes exactly.
 */
export const adminListPlaylists = onCall<AdminListPlaylistsRequest, Promise<AdminListPlaylistsResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const {visibility, creatorId, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('playlists');
  if (creatorId) {
    q = q.where('ownerId', '==', creatorId);
  } else if (visibility) {
    q = q.where('visibility', '==', visibility);
  }
  q = q.orderBy('updatedAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('playlists').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('updatedAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const creators = await resolveCreators(snap.docs.map((doc) => (doc.data().ownerId as string) ?? ''));
  const playlists = snap.docs.map((doc) => toPlaylistListItem(doc, creators));
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {playlists, nextCursor};
});
