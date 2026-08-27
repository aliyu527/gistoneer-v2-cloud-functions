import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {deleteObject} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

interface DeleteMediaUploadRequest {
  uploadId: string;
}

interface DeleteMediaUploadResponse {
  deleted: true;
}

/**
 * Deletes an uploaded (or in-progress) media object from S3 and its
 * mediaUploads ledger record — used when a user removes media from their
 * post before publishing. createPost never links back to this collection,
 * so an upload can only ever be referenced by a draft-in-progress, never by
 * an already-published post; there's no "can't delete, it's live" case to
 * protect against. A video's thumbnail is its own separate mediaUploads
 * record (see mediaService.uploadThumbnail on the client) — the caller
 * deletes it with its own call to this same function, same as confirming
 * an upload is already two separate calls today.
 */
export const deleteMediaUpload = onCall<DeleteMediaUploadRequest, Promise<DeleteMediaUploadResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;

    const {uploadId} = request.data ?? {};
    if (!uploadId || typeof uploadId !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing upload reference.');
    }

    const docRef = db.collection('mediaUploads').doc(uploadId);
    const snap = await docRef.get();
    if (!snap.exists) {
      // Already gone — deleting is idempotent, not an error (a retried call
      // after a network blip shouldn't fail just because the first call's
      // response never made it back).
      return {deleted: true};
    }

    const data = snap.data()!;
    if (data.uid !== uid) {
      // Same "not-found" wording as confirmMediaUpload — don't reveal that
      // the upload exists but belongs to someone else.
      throw new HttpsError('not-found', "We couldn't find that upload.");
    }

    await deleteObject(data.storageKey);
    await docRef.delete();

    return {deleted: true};
  },
);
