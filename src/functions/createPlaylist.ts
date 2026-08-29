import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl} from '../lib/s3';
import {verifyOwnedSoundIds} from '../lib/soundOwnership';

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_TRACKS = 500;
const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

interface CreatePlaylistRequest {
  /** Idempotency key from the client — stable across every retry of the same creation attempt. */
  clientPlaylistId: string;
  name: string;
  description?: string;
  visibility?: Visibility;
  soundIds?: string[];
  artworkUploadId?: string;
}

interface CreatePlaylistResponse {
  playlistId: string;
}

/**
 * Mirrors createSound's exact posture: client-generated idempotency key so
 * a retried call after a dropped response never creates a duplicate, and
 * every referenced sound/artwork upload is re-verified server-side rather
 * than trusted from the client.
 */
export const createPlaylist = onCall<CreatePlaylistRequest, Promise<CreatePlaylistResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const data = request.data ?? ({} as CreatePlaylistRequest);

    if (typeof data.clientPlaylistId !== 'string' || data.clientPlaylistId.length === 0 || data.clientPlaylistId.length > 200) {
      throw new HttpsError('invalid-argument', 'Missing playlist reference.');
    }

    const ref = db.collection('playlists').doc(data.clientPlaylistId);
    const existing = await ref.get();
    if (existing.exists) {
      const existingData = existing.data()!;
      if (existingData.ownerId !== uid) {
        throw new HttpsError('invalid-argument', 'Something went wrong. Please try again.');
      }
      return {playlistId: existing.id};
    }

    const name = (data.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) {
      throw new HttpsError('invalid-argument', 'Please give your playlist a name.');
    }
    const description = (data.description ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH);
    const visibility: Visibility = data.visibility && VISIBILITIES.includes(data.visibility) ? data.visibility : 'private';

    const requestedIds = Array.isArray(data.soundIds) ? data.soundIds.filter((id) => typeof id === 'string').slice(0, MAX_TRACKS) : [];
    const soundIds = requestedIds.length > 0 ? await verifyOwnedSoundIds(requestedIds, uid) : [];

    let artworkUrl: string | null = null;
    let artworkStoragePath: string | null = null;
    if (data.artworkUploadId) {
      const uploadSnap = await db.collection('mediaUploads').doc(data.artworkUploadId).get();
      const upload = uploadSnap.data();
      if (uploadSnap.exists && upload && upload.uid === uid && upload.status === 'uploaded' && upload.mediaType === 'image') {
        artworkUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
        artworkStoragePath = upload.storageKey;
      }
    }

    await ref.set({
      id: ref.id,
      ownerId: uid,
      name,
      ...(description ? {description} : {}),
      artworkUrl,
      ...(artworkStoragePath ? {artworkStoragePath} : {}),
      soundIds,
      trackCount: soundIds.length,
      visibility,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {playlistId: ref.id};
  },
);
