import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {headObject} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

interface ConfirmMediaUploadRequest {
  uploadId: string;
}

interface ConfirmMediaUploadResponse {
  uploadId: string;
  storageKey: string;
  bucket: string;
  region: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'audio';
  fileName: string | null;
  fileSize: number;
  uploadedAt: string;
}

/**
 * Confirms the object the client PUT to S3 actually landed there before
 * trusting "upload succeeded" — a client reporting success after a network
 * blip (or never calling this at all) leaves the record at 'authorized'
 * forever rather than falsely marked 'uploaded'.
 */
export const confirmMediaUpload = onCall<ConfirmMediaUploadRequest, Promise<ConfirmMediaUploadResponse>>(
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
      throw new HttpsError('not-found', "We couldn't find that upload.");
    }

    const data = snap.data()!;
    if (data.uid !== uid) {
      // Same "not-found" wording as above — don't reveal that the upload
      // exists but belongs to someone else.
      throw new HttpsError('not-found', "We couldn't find that upload.");
    }

    if (data.status === 'uploaded') {
      // Already confirmed (e.g. a retried call) — return the same result
      // rather than re-verifying against S3 or erroring.
      return {
        uploadId,
        storageKey: data.storageKey,
        bucket: data.bucket,
        region: data.region,
        mimeType: data.mimeType,
        mediaType: data.mediaType,
        fileName: data.fileName ?? null,
        fileSize: data.fileSize,
        uploadedAt: (data.completedAt?.toDate?.() ?? new Date()).toISOString(),
      };
    }

    const object = await headObject(data.storageKey);
    if (!object) {
      throw new HttpsError('failed-precondition', "We couldn't verify that upload finished. Please try again.");
    }

    const completedAt = new Date();
    await docRef.update({status: 'uploaded', completedAt});

    return {
      uploadId,
      storageKey: data.storageKey,
      bucket: data.bucket,
      region: data.region,
      mimeType: data.mimeType,
      mediaType: data.mediaType,
      fileName: data.fileName ?? null,
      fileSize: object.sizeBytes || data.fileSize,
      uploadedAt: completedAt.toISOString(),
    };
  },
);
