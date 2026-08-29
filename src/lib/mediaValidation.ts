/**
 * Server-side mirror of mobile.beta/src/Services/Media/mediaLimits.ts.
 * Deliberately re-declared rather than shared — a Cloud Function can't
 * import from the Expo app's src/, and this is exactly the kind of value
 * that must be enforced server-side regardless of what the client claims
 * (client validation is UX, this is security). Keep the numbers in sync
 * with the client's MEDIA_LIMITS if either changes.
 */
export const MEDIA_LIMITS = {
  MAX_IMAGE_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB
  MAX_VIDEO_SIZE_BYTES: 200 * 1024 * 1024, // 200 MB
  MAX_AUDIO_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB — mirrors the client's Services/Sound/deviceAudio.ts AUDIO_LIMITS
  ALLOWED_IMAGE_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  ALLOWED_VIDEO_MIME_TYPES: ['video/mp4', 'video/quicktime'],
  ALLOWED_AUDIO_MIME_TYPES: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'],
} as const;

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaUploadRequest {
  mediaType: MediaType;
  mimeType: string;
  fileSize: number;
  mediaFolderId: string;
  fileName?: string;
}

/** Matches the client's generateId('dir') output exactly (Services/Upload/types.ts) — strict on purpose, since this becomes a literal S3 key path segment; anything not matching this shape (e.g. containing `/` or `..`) is rejected outright. */
const MEDIA_FOLDER_ID_PATTERN = /^dir-\d{10,}-[0-9a-z]{1,12}$/;

/** Returns a user-facing error message, or null if the request is valid. */
const ALLOWED_MIME_TYPES_BY_TYPE: Record<MediaType, readonly string[]> = {
  image: MEDIA_LIMITS.ALLOWED_IMAGE_MIME_TYPES,
  video: MEDIA_LIMITS.ALLOWED_VIDEO_MIME_TYPES,
  audio: MEDIA_LIMITS.ALLOWED_AUDIO_MIME_TYPES,
};

const MAX_SIZE_BY_TYPE: Record<MediaType, number> = {
  image: MEDIA_LIMITS.MAX_IMAGE_SIZE_BYTES,
  video: MEDIA_LIMITS.MAX_VIDEO_SIZE_BYTES,
  audio: MEDIA_LIMITS.MAX_AUDIO_SIZE_BYTES,
};

const TOO_LARGE_MESSAGE_BY_TYPE: Record<MediaType, string> = {
  image: 'This image is too large.',
  video: 'This video is too large.',
  audio: 'This audio file is too large.',
};

export function validateUploadRequest(req: MediaUploadRequest): string | null {
  if (req.mediaType !== 'image' && req.mediaType !== 'video' && req.mediaType !== 'audio') {
    return 'Unsupported media type.';
  }
  if (!req.mimeType || typeof req.mimeType !== 'string') {
    return 'Missing or invalid file type.';
  }
  if (!Number.isFinite(req.fileSize) || req.fileSize <= 0) {
    return 'Missing or invalid file size.';
  }
  if (typeof req.mediaFolderId !== 'string' || !MEDIA_FOLDER_ID_PATTERN.test(req.mediaFolderId)) {
    return 'Missing or invalid upload request.';
  }

  if (!ALLOWED_MIME_TYPES_BY_TYPE[req.mediaType].includes(req.mimeType)) {
    return "This file type isn't supported.";
  }

  if (req.fileSize > MAX_SIZE_BY_TYPE[req.mediaType]) {
    return TOO_LARGE_MESSAGE_BY_TYPE[req.mediaType];
  }

  return null;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** Never trust a client-supplied filename/extension — derive it from the validated MIME type instead. */
export function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin';
}
