import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl} from '../lib/s3';

const MAX_TITLE_LENGTH = 200;
const MAX_TAG_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;

interface UpdateSoundRequest {
  soundId: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  description?: string;
  /** A confirmed image upload (mediaUploads) to use as the new artwork. */
  artworkUploadId?: string;
}

interface UpdateSoundResponse {
  soundId: string;
}

/**
 * Partial metadata/artwork update for an existing sound — never a full
 * .set() (that's createSound's job), so a field the caller didn't send is
 * left untouched. Mirrors createSound's ownership-verification posture:
 * confirms the sound belongs to this user, and re-verifies any referenced
 * artwork upload the same way createSound/createPost verify audio/media
 * uploads, never trusting client-supplied storage details directly.
 */
export const updateSound = onCall<UpdateSoundRequest, Promise<UpdateSoundResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const data = request.data ?? ({} as UpdateSoundRequest);

    if (typeof data.soundId !== 'string' || data.soundId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing sound reference.');
    }

    const ref = db.collection('sounds').doc(data.soundId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.ownerId !== uid) {
      throw new HttpsError('not-found', "We couldn't find that sound.");
    }

    const updates: Record<string, unknown> = {};

    if (data.title !== undefined) {
      const title = data.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (!title) {
        throw new HttpsError('invalid-argument', 'Title cannot be empty.');
      }
      updates.title = title;
    }
    if (data.artist !== undefined) updates.artist = data.artist.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.album !== undefined) updates.album = data.album.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.genre !== undefined) updates.genre = data.genre.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.description !== undefined) {
      updates.description = data.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || FieldValue.delete();
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
    }

    if (Object.keys(updates).length === 0) {
      return {soundId: ref.id};
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    await ref.update(updates);

    return {soundId: ref.id};
  },
);
