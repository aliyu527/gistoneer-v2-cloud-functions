import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminPlaylistListItem} from './adminPlaylistShared';

interface AdminSearchPlaylistsRequest {
  query: string;
}

interface AdminSearchPlaylistsResponse {
  playlists: AdminPlaylistListItem[];
}

const SEARCH_LIMIT = 20;

function toListItemUnresolved(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminPlaylistListItem {
  const data = doc.data();
  const ownerId = (data.ownerId as string) ?? '';
  return {
    id: doc.id,
    ownerId,
    creator: {userId: ownerId, username: null, displayName: null, avatarUrl: null},
    name: (data.name as string) ?? 'Untitled Playlist',
    description: (data.description as string) ?? null,
    artworkUrl: (data.artworkUrl as string) ?? null,
    trackCount: typeof data.trackCount === 'number' ? data.trackCount : 0,
    visibility: (data.visibility as AdminPlaylistListItem['visibility']) ?? 'private',
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
  };
}

/** Same exact-lookup pattern as adminSearchSounds.ts: exact playlistId, or exact @username resolved to that creator's playlists. */
export const adminSearchPlaylists = onCall<AdminSearchPlaylistsRequest, Promise<AdminSearchPlaylistsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const playlistSnap = await db.collection('playlists').doc(trimmed).get();
  if (playlistSnap.exists) {
    return {playlists: [toListItemUnresolved(playlistSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  const username = trimmed.replace(/^@/, '').trim().toLowerCase();
  if (username.length === 0) return {playlists: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {playlists: []};

  const creatorDoc = userSnap.docs[0];
  const creator = {
    userId: creatorDoc.id,
    username: (creatorDoc.data().username as string) ?? null,
    displayName: (creatorDoc.data().displayName as string) ?? null,
    avatarUrl: (creatorDoc.data().photoURL as string) ?? null,
  };

  const snap = await db.collection('playlists').where('ownerId', '==', creatorDoc.id).orderBy('updatedAt', 'desc').limit(SEARCH_LIMIT).get();
  const playlists = snap.docs.map((doc) => ({...toListItemUnresolved(doc), creator}));
  return {playlists};
});
