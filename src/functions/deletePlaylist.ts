import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {deleteObject} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

interface DeletePlaylistRequest {
  playlistId: string;
}

interface DeletePlaylistResponse {
  deleted: true;
}

/**
 * Deletes a playlist's own artwork object (if any) and its Firestore doc —
 * NEVER touches any sound's audio/artwork object or the sounds collection
 * itself. A playlist only ever references sounds by ID; removing the
 * playlist removes the reference, not the referenced content. Same
 * idempotent, ownership-checked posture as deleteSound.
 */
export const deletePlaylist = onCall<DeletePlaylistRequest, Promise<DeletePlaylistResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;

    const {playlistId} = request.data ?? {};
    if (!playlistId || typeof playlistId !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing playlist reference.');
    }

    const docRef = db.collection('playlists').doc(playlistId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return {deleted: true};
    }

    const data = snap.data()!;
    if (data.ownerId !== uid) {
      throw new HttpsError('not-found', "We couldn't find that playlist.");
    }

    if (data.artworkStoragePath) {
      await deleteObject(data.artworkStoragePath);
    }
    await docRef.delete();

    return {deleted: true};
  },
);
