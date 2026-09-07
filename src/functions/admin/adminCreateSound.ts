import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl, uploadBuffer} from '../../lib/s3';
import {AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../../config';
import {extensionForMimeType} from '../../lib/mediaValidation';
import {processUploadedAudio} from '../../sounds/audioProcessing';
import {requireActiveAdmin} from './requireActiveAdmin';
import {enforceRateLimit} from '../../lib/rateLimit';
import {writeAuditLog} from './writeAuditLog';
import {notifyAdmins} from '../../adminNotifications/service';

const MAX_TITLE_LENGTH = 200;
const MAX_TAG_LENGTH = 200;
const DEFAULT_TITLE = 'Untitled Sound';
const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

interface AdminCreateSoundRequest {
  uploadId: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  categoryIds?: string[];
  visibility?: Visibility;
}

interface AdminCreateSoundResponse {
  soundId: string;
}

/**
 * Admin-triggered catalog upload — same sounds/{id} collection every user
 * upload already writes to, distinguished only by source:'admin_upload' and
 * ownerId: the creating admin's own uid, so every existing query (usage
 * counts, playlist compatibility, moderation) works on catalog tracks with
 * zero new query paths. Runs the same shared audioProcessing pipeline
 * createSound.ts uses (metadata + embedded cover extraction), plus admin-
 * supplied metadata overriding extracted tags where explicitly provided.
 */
export const adminCreateSound = onCall<AdminCreateSoundRequest, Promise<AdminCreateSoundResponse>>(
  {cors: true, secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY], region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'sounds.write');
    await enforceRateLimit(admin.uid, 'adminCreateSound', {maxPerWindow: 20, windowMs: 10 * 60 * 1000});

    const data = request.data ?? ({} as AdminCreateSoundRequest);
    if (typeof data.uploadId !== 'string' || data.uploadId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing upload reference.');
    }
    const visibility: Visibility = data.visibility && VISIBILITIES.includes(data.visibility) ? data.visibility : 'private';
    const categoryIds = Array.isArray(data.categoryIds) ? [...new Set(data.categoryIds.filter((id) => typeof id === 'string'))] : [];

    const uploadSnap = await db.collection('mediaUploads').doc(data.uploadId).get();
    if (!uploadSnap.exists) {
      throw new HttpsError('failed-precondition', "We couldn't find that upload. Please try again.");
    }
    const upload = uploadSnap.data()!;
    if (upload.uid !== admin.uid || upload.status !== 'uploaded' || upload.mediaType !== 'audio') {
      throw new HttpsError('failed-precondition', "That upload hasn't finished. Please try again.");
    }

    const ref = db.collection('sounds').doc();

    let tags;
    let cover;
    try {
      ({tags, cover} = await processUploadedAudio(upload.storageKey));
    } catch (error) {
      await notifyAdmins({
        type: 'sound.processing_failed',
        category: 'catalog',
        priority: 'high',
        title: 'Audio processing failed',
        message: `Processing failed for an upload by ${admin.email ?? admin.uid}. Please check the file and try again.`,
        targetPermission: 'sounds.write',
        actionUrl: '/sounds',
        excludeUids: [admin.uid],
        createdBy: admin.uid,
      }).catch(() => {});
      throw new HttpsError('internal', 'Audio processing failed. Please verify the audio file and try again.');
    }

    const clientTitle = (data.title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
    const title = clientTitle || tags.title?.slice(0, MAX_TITLE_LENGTH) || DEFAULT_TITLE;
    const artist = (data.artist ?? '').trim().slice(0, MAX_TAG_LENGTH) || tags.artist?.slice(0, MAX_TAG_LENGTH);
    const album = (data.album ?? '').trim().slice(0, MAX_TAG_LENGTH) || tags.album?.slice(0, MAX_TAG_LENGTH);
    const genre = (data.genre ?? '').trim().slice(0, MAX_TAG_LENGTH) || tags.genre?.slice(0, MAX_TAG_LENGTH);
    const durationMs = tags.durationMs;
    const technicalMetadata = tags.technicalMetadata
      ? Object.fromEntries(Object.entries(tags.technicalMetadata).filter(([, v]) => v !== undefined))
      : undefined;

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
      ownerId: admin.uid,
      title,
      titleLower: title.toLowerCase(),
      ...(artist ? {artist} : {}),
      ...(album ? {album} : {}),
      ...(genre ? {genre} : {}),
      originalFileName: upload.fileName ?? null,
      mimeType: upload.mimeType,
      extension: extensionForMimeType(upload.mimeType),
      size: upload.fileSize,
      ...(durationMs ? {durationMs} : {}),
      ...(technicalMetadata && Object.keys(technicalMetadata).length > 0 ? {technicalMetadata} : {}),
      audioUrl: buildPublicUrl(upload.storageKey, upload.bucket, upload.region),
      storagePath: upload.storageKey,
      artworkUrl,
      ...(artworkStoragePath ? {artworkStoragePath} : {}),
      ...(categoryIds.length > 0 ? {categoryIds} : {}),
      source: 'admin_upload',
      uploadedBy: admin.email,
      status: 'ready',
      visibility,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'sound.create',
      targetType: 'sound',
      targetId: ref.id,
      reason: `Uploaded catalog track: ${title}`,
    }).catch(() => {});

    return {soundId: ref.id};
  },
);
