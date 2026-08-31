import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {verifyPlaylistSoundIds, CATALOG_SOUND_ID_PREFIX} from '../../lib/soundOwnership';

const SOURCES = ['LIBRARY', 'CATALOG'] as const;
type Source = (typeof SOURCES)[number];

interface AddSoundToPlaylistRequest {
  playlistId: string;
  /** A sounds/{id} doc id for LIBRARY, or a providerTrackId for CATALOG. */
  trackId: string;
  source: Source;
}

interface AddSoundToPlaylistResponse {
  playlistId: string;
  added: boolean;
}

/**
 * The single-track convenience entry point Sound Details' "Add to Playlist"
 * uses — updatePlaylist's own soundIds field already supports this (a full
 * replace), this just does the read-append-verify-write round trip so the
 * caller doesn't have to fetch the playlist's current list itself first.
 * Same ownership/verification posture as updatePlaylist, not a new
 * mutation path.
 */
export const addSoundToPlaylist = onCall<AddSoundToPlaylistRequest, Promise<AddSoundToPlaylistResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const {playlistId, trackId, source} = request.data ?? {};

    if (typeof playlistId !== 'string' || playlistId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing playlist reference.');
    }
    if (typeof trackId !== 'string' || trackId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing sound reference.');
    }
    if (!SOURCES.includes(source)) {
      throw new HttpsError('invalid-argument', 'Invalid sound source.');
    }

    const ref = db.collection('playlists').doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.ownerId !== uid) {
      throw new HttpsError('not-found', "We couldn't find that playlist.");
    }

    const soundId = source === 'CATALOG' ? `${CATALOG_SOUND_ID_PREFIX}${trackId}` : trackId;
    const verified = await verifyPlaylistSoundIds([soundId], uid);
    if (verified.length === 0) {
      throw new HttpsError('failed-precondition', "This sound can't be added right now.");
    }

    const existingSoundIds: string[] = snap.data()!.soundIds ?? [];
    if (existingSoundIds.includes(soundId)) {
      return {playlistId: ref.id, added: false};
    }

    const soundIds = [...existingSoundIds, soundId];
    await ref.update({soundIds, trackCount: soundIds.length, updatedAt: FieldValue.serverTimestamp()});
    return {playlistId: ref.id, added: true};
  },
);
