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

interface UpdatePlaylistRequest {
  playlistId: string;
  name?: string;
  description?: string;
  visibility?: Visibility;
  /** When present, REPLACES the whole track list (covers add/remove/reorder in one call) — re-verified/deduped the same way createPlaylist does. */
  soundIds?: string[];
  artworkUploadId?: string;
}

interface UpdatePlaylistResponse {
  playlistId: string;
}

/**
 * Partial update — only .update(), never .set(), so an untouched field is
 * never clobbered. Same ownership/idempotency posture as updateSound.
 */
export const updatePlaylist = onCall<UpdatePlaylistRequest, Promise<UpdatePlaylistResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const data = request.data ?? ({} as UpdatePlaylistRequest);

    if (typeof data.playlistId !== 'string' || data.playlistId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing playlist reference.');
    }

    const ref = db.collection('playlists').doc(data.playlistId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.ownerId !== uid) {
      throw new HttpsError('not-found', "We couldn't find that playlist.");
    }

    const updates: Record<string, unknown> = {};

    if (data.name !== undefined) {
      const name = data.name.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) {
        throw new HttpsError('invalid-argument', 'Playlist name cannot be empty.');
      }
      updates.name = name;
    }
    if (data.description !== undefined) {
      updates.description = data.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || FieldValue.delete();
    }
    if (data.visibility !== undefined) {
      if (!VISIBILITIES.includes(data.visibility)) {
        throw new HttpsError('invalid-argument', 'Invalid visibility.');
      }
      updates.visibility = data.visibility;
    }

    if (data.soundIds !== undefined) {
      const requestedIds = Array.isArray(data.soundIds) ? data.soundIds.filter((id) => typeof id === 'string').slice(0, MAX_TRACKS) : [];
      const soundIds = requestedIds.length > 0 ? await verifyOwnedSoundIds(requestedIds, uid) : [];
      updates.soundIds = soundIds;
      updates.trackCount = soundIds.length;
    }

    if (data.artworkUploadId) {
      const uploadSnap = await db.collection('mediaUploads').doc(data.artworkUploadId).get();
      if (!uploadSnap.exists) {
        throw new HttpsError('failed-precondition', "We couldn't find that artwork upload. Please try again.");
      }
      const upload = uploadSnap.data()!;
      if (upload.uid !== uid || upload.status !== 'uploaded' || upload.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "That artwork hasn't finished uploading. Please try again.");
      }
      updates.artworkUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
      updates.artworkStoragePath = upload.storageKey;
    }

    if (Object.keys(updates).length === 0) {
      return {playlistId: ref.id};
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    await ref.update(updates);

    return {playlistId: ref.id};
  },
);
