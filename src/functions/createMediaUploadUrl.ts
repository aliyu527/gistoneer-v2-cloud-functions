import {randomUUID} from 'crypto';
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {generatePresignedPutUrl, getBucketName, getRegion} from '../lib/s3';
import {validateUploadRequest, extensionForMimeType, type MediaType} from '../lib/mediaValidation';
import {enforceRateLimit} from '../lib/rateLimit';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

interface CreateMediaUploadUrlRequest {
  mediaType: MediaType;
  mimeType: string;
  fileSize: number;
  mediaFolderId: string;
  fileName?: string;
}

interface CreateMediaUploadUrlResponse {
  uploadId: string;
  uploadUrl: string;
  storageKey: string;
}

/**
 * Issues a short-lived, single-object presigned S3 PUT URL for the
 * authenticated user. The client never chooses (or even sees) the bucket,
 * region, or S3 key beforehand — this function generates all of it and
 * hands back only what's needed to perform the upload.
 */
export const createMediaUploadUrl = onCall<CreateMediaUploadUrlRequest, Promise<CreateMediaUploadUrlResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;

    // Each call issues a real, usable presigned S3 PUT URL — the single
    // most cost-sensitive endpoint in the upload flow. 30/10min is generous
    // for legitimate use (well above any normal creation session) while
    // blocking scripted hammering.
    await enforceRateLimit(uid, 'createMediaUploadUrl', {maxPerWindow: 30, windowMs: 10 * 60 * 1000});

    const {mediaType, mimeType, fileSize, mediaFolderId, fileName} = request.data ?? {};
    const validationError = validateUploadRequest({mediaType, mimeType, fileSize, mediaFolderId, fileName});
    if (validationError) {
      throw new HttpsError('invalid-argument', validationError);
    }

    const uploadId = randomUUID();
    const extension = extensionForMimeType(mimeType);
    // One folder per post — every file for a post (photo, video, thumbnail,
    // sound) shares mediaFolderId, generated once client-side. mediaType
    // prefixes the filename so the folder's contents are self-describing.
    // users/{uid}/ prefix namespaces every object by owner in the bucket
    // itself (defense-in-depth/cost-attribution — ownership is already
    // fully enforced via the mediaUploads Firestore doc regardless).
    const storageKey = `users/${uid}/${mediaFolderId}/${mediaType}-${randomUUID()}.${extension}`;

    const uploadUrl = await generatePresignedPutUrl(storageKey, mimeType);

    await db.collection('mediaUploads').doc(uploadId).set({
      uid,
      status: 'authorized',
      mediaType,
      mimeType,
      fileSize,
      fileName: fileName ?? null,
      mediaFolderId,
      storageKey,
      bucket: getBucketName(),
      region: getRegion(),
      createdAt: new Date(),
      completedAt: null,
    });

    return {uploadId, uploadUrl, storageKey};
  },
);
