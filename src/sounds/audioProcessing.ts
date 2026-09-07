import {logger} from 'firebase-functions/v2';
import {getObjectBuffer} from '../lib/s3';
import {MEDIA_LIMITS} from '../lib/mediaValidation';

const MAX_TAG_LENGTH = 200;

export interface ExtractedTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  durationMs?: number;
  technicalMetadata?: {
    bitrateKbps?: number;
    sampleRateHz?: number;
    channels?: number;
    codec?: string;
  };
}

export interface ExtractedCoverArt {
  buffer: Buffer;
  mimeType: string;
}

/**
 * music-metadata is ESM-only, and this project compiles to CommonJS —
 * hidden from TS's static downleveling so Node's native dynamic import
 * actually runs (verified against compiled lib/ output). Shared by
 * createSound.ts (user uploads) and adminCreateSound.ts (catalog uploads)
 * so both get identical extraction behavior from one place.
 */
const importMusicMetadata = () => Function('return import("music-metadata")')() as Promise<typeof import('music-metadata')>;

/** Extracted once from createSound.ts, behavior unchanged — a parse failure is swallowed, never surfaced; extraction is enrichment, not a requirement. */
export async function extractAudioMetadata(buffer: Buffer): Promise<ExtractedTags> {
  try {
    const {parseBuffer} = await importMusicMetadata();
    const {common, format} = await parseBuffer(buffer);
    return {
      title: common.title?.trim() || undefined,
      artist: common.artist?.trim() || undefined,
      album: common.album?.trim() || undefined,
      genre: common.genre?.[0]?.trim() || undefined,
      durationMs: format.duration ? Math.round(format.duration * 1000) : undefined,
      technicalMetadata: {
        bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
        sampleRateHz: format.sampleRate,
        channels: format.numberOfChannels,
        codec: format.codec,
      },
    };
  } catch (err) {
    logger.warn('extractAudioMetadata: tag extraction failed, continuing with client-supplied metadata', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

/**
 * Reads the first embedded picture (ID3/MP4/FLAC/Vorbis artwork — whatever
 * music-metadata's unified `common.picture` exposes for the given format).
 * Validated against the exact same MIME-type allowlist and size cap every
 * other image upload in this codebase already uses (MEDIA_LIMITS) — no
 * deeper decode-validation, since no such infrastructure (e.g. sharp)
 * exists anywhere else in this app either; holding embedded artwork to a
 * stricter bar than every other image upload path would be inconsistent,
 * not more secure. Returns null on absence or failure — cover extraction
 * never blocks the audio upload itself.
 */
export async function extractEmbeddedCoverArt(buffer: Buffer): Promise<ExtractedCoverArt | null> {
  try {
    const {parseBuffer} = await importMusicMetadata();
    const {common} = await parseBuffer(buffer);
    const picture = common.picture?.[0];
    if (!picture) return null;

    const mimeType = picture.format;
    if (!MEDIA_LIMITS.ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as (typeof MEDIA_LIMITS.ALLOWED_IMAGE_MIME_TYPES)[number])) {
      logger.warn('extractEmbeddedCoverArt: unsupported embedded picture format, skipping', {mimeType});
      return null;
    }

    const pictureBuffer = Buffer.isBuffer(picture.data) ? picture.data : Buffer.from(picture.data);
    if (pictureBuffer.length === 0 || pictureBuffer.length > MEDIA_LIMITS.MAX_IMAGE_SIZE_BYTES) {
      logger.warn('extractEmbeddedCoverArt: embedded picture missing or too large, skipping', {sizeBytes: pictureBuffer.length});
      return null;
    }

    return {buffer: pictureBuffer, mimeType};
  } catch (err) {
    logger.warn('extractEmbeddedCoverArt: extraction failed, continuing without cover', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Convenience wrapper: fetches the just-uploaded object once and runs both extractors against the same buffer, avoiding two separate S3 reads. */
export async function processUploadedAudio(storageKey: string): Promise<{tags: ExtractedTags; cover: ExtractedCoverArt | null}> {
  const buffer = await getObjectBuffer(storageKey);
  const [tags, cover] = await Promise.all([extractAudioMetadata(buffer), extractEmbeddedCoverArt(buffer)]);
  return {tags, cover};
}

export {MAX_TAG_LENGTH};
