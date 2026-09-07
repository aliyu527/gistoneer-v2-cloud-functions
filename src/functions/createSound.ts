import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl, uploadBuffer} from '../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../config';
import {enforceRateLimit} from '../lib/rateLimit';
import {processUploadedAudio} from '../sounds/audioProcessing';
import {extensionForMimeType} from '../lib/mediaValidation';

const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = 'Untitled Sound';
const MAX_TAG_LENGTH = 200;

const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

interface CreateSoundRequest {
  /** Idempotency key from the client — stable across every retry of the same upload attempt. */
  clientSoundId: string;
  uploadId: string;
  title?: string;
  durationMs?: number;
  visibility?: Visibility;
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
    await enforceRateLimit(uid, 'createSound', {maxPerWindow: 20, windowMs: 10 * 60 * 1000});
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

    const {tags, cover} = await processUploadedAudio(upload.storageKey);

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

    // Embedded cover art is used automatically when present — the user can
    // still replace it afterward via updateSound's separate-image-upload
    // path, which always overwrites whatever's here.
    let artworkUrl: string | null = null;
    let artworkStoragePath: string | null = null;
    if (cover) {
      const coverKey = `sounds/${ref.id}/cover.${extensionForMimeType(cover.mimeType)}`;
      await uploadBuffer(coverKey, cover.buffer, cover.mimeType);
      artworkUrl = buildPublicUrl(coverKey, upload.bucket, upload.region);
      artworkStoragePath = coverKey;
    }

    await ref.set({
      id: ref.id,
      ownerId: uid,
      title,
      titleLower: title.toLowerCase(),
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
      artworkUrl,
      ...(artworkStoragePath ? {artworkStoragePath} : {}),
      source: 'user_upload',
      status: 'ready',
      visibility: data.visibility && VISIBILITIES.includes(data.visibility) ? data.visibility : 'public',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {soundId: ref.id};
  },
);
