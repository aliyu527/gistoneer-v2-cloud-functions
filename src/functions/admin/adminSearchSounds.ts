import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminSoundListItem} from './adminListSounds';

interface AdminSearchSoundsRequest {
  query: string;
}

interface AdminSearchSoundsResponse {
  sounds: AdminSoundListItem[];
}

const SEARCH_LIMIT = 20;

function toListItemUnresolved(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminSoundListItem {
  const data = doc.data();
  const ownerId = (data.ownerId as string) ?? '';
  return {
    id: doc.id,
    ownerId,
    creator: {userId: ownerId, username: null, displayName: null, avatarUrl: null},
    title: (data.title as string) ?? 'Untitled Sound',
    artist: (data.artist as string) ?? null,
    album: (data.album as string) ?? null,
    genre: (data.genre as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    audioUrl: (data.audioUrl as string) ?? '',
    durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
    visibility: (data.visibility as AdminSoundListItem['visibility']) ?? 'public',
    moderationStatus: (data.moderationStatus as AdminSoundListItem['moderationStatus']) ?? 'active',
    source: (data.source as AdminSoundListItem['source']) ?? 'user_upload',
    categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds : [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

async function hydrateCreator(item: AdminSoundListItem): Promise<AdminSoundListItem> {
  const userSnap = await db.collection('users').doc(item.ownerId).get();
  if (!userSnap.exists) return item;
  const data = userSnap.data()!;
  return {
    ...item,
    creator: {
      userId: item.ownerId,
      username: (data.username as string) ?? null,
      displayName: (data.displayName as string) ?? null,
      avatarUrl: (data.photoURL as string) ?? null,
    },
  };
}

/**
 * Admin-only sound search: exact soundId, or exact @username resolved to
 * that creator's sounds (identical pattern to adminSearchContent.ts). No
 * free-text title/artist search — would need a titleLower mirror field
 * written by createSound.ts/updateSound.ts (core app functions, out of
 * scope here) and existing sounds have no such field to retrofit.
 */
export const adminSearchSounds = onCall<AdminSearchSoundsRequest, Promise<AdminSearchSoundsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const soundSnap = await db.collection('sounds').doc(trimmed).get();
  if (soundSnap.exists) {
    const item = await hydrateCreator(toListItemUnresolved(soundSnap as FirebaseFirestore.QueryDocumentSnapshot));
    return {sounds: [item]};
  }

  const username = trimmed.replace(/^@/, '').trim().toLowerCase();
  if (username.length === 0) return {sounds: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {sounds: []};

  const creatorDoc = userSnap.docs[0];
  const creator = {
    userId: creatorDoc.id,
    username: (creatorDoc.data().username as string) ?? null,
    displayName: (creatorDoc.data().displayName as string) ?? null,
    avatarUrl: (creatorDoc.data().photoURL as string) ?? null,
  };

  const snap = await db.collection('sounds').where('ownerId', '==', creatorDoc.id).orderBy('createdAt', 'desc').limit(SEARCH_LIMIT).get();
  const sounds = snap.docs.map((doc) => ({...toListItemUnresolved(doc), creator}));
  return {sounds};
});
