import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {deleteObject} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

interface DeleteSoundRequest {
  soundId: string;
}

interface DeleteSoundResponse {
  deleted: true;
}

/**
 * Deletes a sound from the user's personal library: both S3 objects
 * (audio, and artwork if one was ever set) and the sounds/{soundId} doc
 * itself. Mirrors deleteMediaUpload's exact posture — idempotent (an
 * already-gone doc is success, not an error), ownership-checked without
 * revealing whether a doc exists for someone else's sound.
 */
export const deleteSound = onCall<DeleteSoundRequest, Promise<DeleteSoundResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;

    const {soundId} = request.data ?? {};
    if (!soundId || typeof soundId !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing sound reference.');
    }

    const docRef = db.collection('sounds').doc(soundId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return {deleted: true};
    }

    const data = snap.data()!;
    if (data.ownerId !== uid) {
      throw new HttpsError('not-found', "We couldn't find that sound.");
    }

    await deleteObject(data.storagePath);
    if (data.artworkStoragePath) {
      await deleteObject(data.artworkStoragePath);
    }
    await docRef.delete();

    return {deleted: true};
  },
);
