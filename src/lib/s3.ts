import {S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_ALBUM_BUCKET} from '../config';

const PRESIGNED_URL_TTL_SECONDS = 5 * 60; // 5 minutes — short-lived by design

let cachedClient: S3Client | null = null;

/**
 * Lazily constructs the S3 client from the resolved secret/config values.
 * Cloud Functions params (defineSecret/defineString) only have real values
 * once the function is actually invoked — constructing this at module load
 * time would read empty strings.
 */
function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: AWS_REGION.value(),
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID.value(),
        secretAccessKey: AWS_SECRET_ACCESS_KEY.value(),
      },
    });
  }
  return cachedClient;
}

export function getBucketName(): string {
  return AWS_S3_ALBUM_BUCKET.value();
}

export function getRegion(): string {
  return AWS_REGION.value();
}

/**
 * A single-PUT, single-key, fixed-Content-Type presigned URL — the client
 * can only upload exactly the object this was issued for, nothing broader.
 */
export async function generatePresignedPutUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, {expiresIn: PRESIGNED_URL_TTL_SECONDS});
}

/**
 * The canonical virtual-hosted-style S3 URL for an object. Takes the bucket
 * and region as explicit params (rather than re-reading current config) so
 * it always reflects where a specific already-uploaded object actually
 * lives, per its own mediaUploads record. No CDN exists in front of the
 * bucket yet — swapping one in later only means changing this function, not
 * the post schema, since storageKey/bucket are kept alongside the derived url.
 */
export function buildPublicUrl(key: string, bucket: string, region: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Confirms an object actually exists in S3 (used by confirmMediaUpload so a
 * client can't just claim success after a failed/interrupted PUT). Returns
 * the object's size for a sanity check against the size the client reported
 * at authorization time, or null if the object doesn't exist.
 */
export async function headObject(key: string): Promise<{sizeBytes: number} | null> {
  try {
    const result = await getClient().send(
      new HeadObjectCommand({Bucket: getBucketName(), Key: key}),
    );
    return {sizeBytes: result.ContentLength ?? 0};
  } catch (err) {
    const code = (err as {name?: string})?.name;
    if (code === 'NotFound' || code === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Fetches an object's full bytes (createSound uses this to read a just-
 * uploaded audio file for tag extraction — audio uploads are capped at
 * 20MB, comfortably within a Cloud Function's memory/time budget).
 * `transformToByteArray()` is the SDK's own cross-runtime way to drain the
 * response body, rather than hand-rolling Readable/stream handling.
 */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await getClient().send(new GetObjectCommand({Bucket: getBucketName(), Key: key}));
  const bytes = await result.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** S3 DeleteObject is itself idempotent — deleting an already-gone (or never-uploaded) key succeeds silently. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({Bucket: getBucketName(), Key: key}));
}
