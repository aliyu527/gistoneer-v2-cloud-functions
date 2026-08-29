import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {logger} from 'firebase-functions/v2';
import {db} from '../admin';
import {buildPublicUrl, getObjectBuffer} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';

const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = 'Untitled Sound';
const MAX_TAG_LENGTH = 200;

interface ExtractedTags {
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

/**
 * music-metadata is ESM-only, and this project compiles to CommonJS
 * (tsconfig's `module: "commonjs"`, unchanged project-wide since switching
 * it would affect every function, not just this one). TypeScript's own
 * `import()` downleveling turns a plain dynamic import into `require()`
 * under that target, which throws (ERR_REQUIRE_ESM) against a real ESM
 * package. `Function('return import(...)')()` is the standard, narrowly-
 * scoped workaround: it hides the import from TS's static downleveling so
 * Node's own native dynamic import actually runs. Verified against the
 * compiled lib/ output, not assumed.
 */
const importMusicMetadata = () => Function('return import("music-metadata")')() as Promise<typeof import('music-metadata')>;

/**
 * Reads embedded tags (ID3 etc.) directly from the just-uploaded file —
 * music-metadata is pure JS (no native binary), the one small dependency
 * this module adds specifically for this. A parse failure (corrupt/unusual
 * file) is swallowed here, never surfaced to the caller — extraction is
 * enrichment, not a requirement; the upload must still succeed with
 * filename-only metadata.
 */
async function extractTags(storageKey: string): Promise<ExtractedTags> {
  try {
    const {parseBuffer} = await importMusicMetadata();
    const buffer = await getObjectBuffer(storageKey);
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
    logger.warn('createSound: tag extraction failed, continuing with client-supplied metadata', {
      storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

interface CreateSoundRequest {
  /** Idempotency key from the client — stable across every retry of the same upload attempt. */
  clientSoundId: string;
  uploadId: string;
  title?: string;
  durationMs?: number;
}

interface CreateSoundResponse {
  soundId: string;
}

function extensionFromMimeType(mimeType: string): string {
  const known: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  };
  return known[mimeType] ?? 'audio';
}

/**
 * Saves metadata for an already-uploaded (confirmed) audio file into the
 * user's personal sound library. Mirrors createPost's exact posture: never
 * trusts client-supplied storage details, re-verifies the referenced
 * mediaUploads record server-side, and uses a client-generated idempotency
 * key so a retried call after a dropped response never creates a duplicate.
 * No transcoding/processing here — the file is stored and used as-is
 * (Module 3's territory), so status is honestly 'ready' immediately.
 */
export const createSound = onCall<CreateSoundRequest, Promise<CreateSoundResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const data = request.data ?? ({} as CreateSoundRequest);

    if (typeof data.clientSoundId !== 'string' || data.clientSoundId.length === 0 || data.clientSoundId.length > 200) {
      throw new HttpsError('invalid-argument', 'Missing sound reference.');
    }
    if (typeof data.uploadId !== 'string' || data.uploadId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing upload reference.');
    }

    const ref = db.collection('sounds').doc(data.clientSoundId);
    const existing = await ref.get();
    if (existing.exists) {
      const existingData = existing.data()!;
      if (existingData.ownerId !== uid) {
        // Practically unreachable (clientSoundId is a random client-generated
        // string) — same non-revealing posture createPost uses for the same case.
        throw new HttpsError('invalid-argument', 'Something went wrong. Please try again.');
      }
      return {soundId: existing.id};
    }

    const uploadSnap = await db.collection('mediaUploads').doc(data.uploadId).get();
    if (!uploadSnap.exists) {
      throw new HttpsError('failed-precondition', "We couldn't find that upload. Please try again.");
    }
    const upload = uploadSnap.data()!;
    if (upload.uid !== uid || upload.status !== 'uploaded' || upload.mediaType !== 'audio') {
      throw new HttpsError('failed-precondition', "That upload hasn't finished. Please try again.");
    }

    const clientTitle = (data.title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
    const clientDurationMs = Number.isFinite(data.durationMs) && (data.durationMs ?? 0) > 0 ? data.durationMs : undefined;

    const tags = await extractTags(upload.storageKey);

    // Priority: embedded tag -> client-supplied (filename-derived) -> default.
    const title = tags.title?.slice(0, MAX_TITLE_LENGTH) || clientTitle || DEFAULT_TITLE;
    const artist = tags.artist?.slice(0, MAX_TAG_LENGTH);
    const album = tags.album?.slice(0, MAX_TAG_LENGTH);
    const genre = tags.genre?.slice(0, MAX_TAG_LENGTH);
    // Server-parsed duration is authoritative when available.
    const durationMs = tags.durationMs ?? clientDurationMs;
    const technicalMetadata = tags.technicalMetadata
      ? Object.fromEntries(Object.entries(tags.technicalMetadata).filter(([, v]) => v !== undefined))
      : undefined;

    await ref.set({
      id: ref.id,
      ownerId: uid,
      title,
      ...(artist ? {artist} : {}),
      ...(album ? {album} : {}),
      ...(genre ? {genre} : {}),
      originalFileName: upload.fileName ?? null,
      mimeType: upload.mimeType,
      extension: extensionFromMimeType(upload.mimeType),
      size: upload.fileSize,
      ...(durationMs ? {durationMs} : {}),
      ...(technicalMetadata && Object.keys(technicalMetadata).length > 0 ? {technicalMetadata} : {}),
      audioUrl: buildPublicUrl(upload.storageKey, upload.bucket, upload.region),
      storagePath: upload.storageKey,
      artworkUrl: null,
      source: 'user_upload',
      status: 'ready',
      visibility: 'private',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {soundId: ref.id};
  },
);
