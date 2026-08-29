import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl} from '../lib/s3';

const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = 'Untitled Sound';

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
  {cors: true, region: 'us-central1'},
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

    const title = (data.title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || DEFAULT_TITLE;
    const durationMs = Number.isFinite(data.durationMs) && (data.durationMs ?? 0) > 0 ? data.durationMs : undefined;

    await ref.set({
      id: ref.id,
      ownerId: uid,
      title,
      originalFileName: upload.fileName ?? null,
      mimeType: upload.mimeType,
      extension: extensionFromMimeType(upload.mimeType),
      size: upload.fileSize,
      ...(durationMs ? {durationMs} : {}),
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
