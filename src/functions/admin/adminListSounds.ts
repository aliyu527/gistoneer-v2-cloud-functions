import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export type SoundModerationStatus = 'active' | 'hidden' | 'removed';

export interface AdminSoundCreator {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AdminSoundListItem {
  id: string;
  ownerId: string;
  creator: AdminSoundCreator;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  artworkUrl: string | null;
  audioUrl: string;
  durationMs: number | null;
  visibility: 'public' | 'private';
  moderationStatus: SoundModerationStatus;
  source: 'user_upload' | 'admin_upload';
  categoryIds: string[];
  createdAt: string | null;
}

interface AdminListSoundsRequest {
  moderationStatus?: SoundModerationStatus;
  visibility?: 'public' | 'private';
  creatorId?: string;
  categoryId?: string;
  sortBy?: 'createdAt' | 'title';
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListSoundsResponse {
  sounds: AdminSoundListItem[];
  nextCursor: string | null;
}

/** Firestore's `in` query caps at 30 values; chunk conservatively at 10, matching the existing convention in lib/soundOwnership.ts. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function resolveCreators(ownerIds: string[]): Promise<Map<string, AdminSoundCreator>> {
  const uniqueIds = [...new Set(ownerIds)];
  const map = new Map<string, AdminSoundCreator>();
  const results = await Promise.all(
    chunk(uniqueIds, 10).map((batch) => db.collection('users').where('__name__', 'in', batch).get()),
  );
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

function toSoundListItem(doc: FirebaseFirestore.QueryDocumentSnapshot, creators: Map<string, AdminSoundCreator>): AdminSoundListItem {
  const data = doc.data();
  const ownerId = (data.ownerId as string) ?? '';
  return {
    id: doc.id,
    ownerId,
    creator: creators.get(ownerId) ?? {userId: ownerId, username: null, displayName: null, avatarUrl: null},
    title: (data.title as string) ?? 'Untitled Sound',
    artist: (data.artist as string) ?? null,
    album: (data.album as string) ?? null,
    genre: (data.genre as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    audioUrl: (data.audioUrl as string) ?? '',
    durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
    visibility: (data.visibility as AdminSoundListItem['visibility']) ?? 'public',
    // Every sound created before this module predates this field.
    moderationStatus: (data.moderationStatus as SoundModerationStatus) ?? 'active',
    // Every sound created before the Sound Catalog module predates this field.
    source: (data.source as AdminSoundListItem['source']) ?? 'user_upload',
    categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds : [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Paginated, filterable admin sound list. `sounds` doesn't denormalize
 * creator info (unlike `posts.author`), so creators are batch-resolved per
 * page via `where(documentId(),'in',...)` rather than one query per row —
 * at most 2 batched queries for a 20-item page, never N+1. Filters are used
 * one at a time to match the indexed combinations (see
 * firestore.indexes.json); alphabetical (`title`) sort is only offered when
 * `creatorId` is set, matching the existing `(ownerId, title)` index.
 */
export const adminListSounds = onCall<AdminListSoundsRequest, Promise<AdminListSoundsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const {moderationStatus, visibility, creatorId, categoryId, sortBy = 'createdAt', sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('sounds');
  if (creatorId) {
    q = q.where('ownerId', '==', creatorId);
  } else if (categoryId) {
    q = q.where('categoryIds', 'array-contains', categoryId);
  } else if (moderationStatus) {
    q = q.where('moderationStatus', '==', moderationStatus);
  } else if (visibility) {
    q = q.where('visibility', '==', visibility);
  }

  const effectiveSortBy = creatorId && sortBy === 'title' ? 'title' : 'createdAt';
  q = q.orderBy(effectiveSortBy, sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('sounds').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get(effectiveSortBy), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const creators = await resolveCreators(snap.docs.map((doc) => (doc.data().ownerId as string) ?? ''));
  const sounds = snap.docs.map((doc) => toSoundListItem(doc, creators));
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {sounds, nextCursor};
});
