import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

const MAX_TITLE_LENGTH = 200;
const MAX_TAG_LENGTH = 200;
const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

interface AdminUpdateSoundRequest {
  soundId: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  categoryIds?: string[];
  artworkUploadId?: string;
  visibility?: Visibility;
}

interface AdminUpdateSoundResponse {
  soundId: string;
}

/**
 * Any authorized admin can edit any catalog track — deliberately not
 * owner-restricted like the mobile-facing updateSound.ts (which only lets a
 * user edit their own upload). Publish/unpublish is just this function
 * changing `visibility`, reusing the existing field rather than a new
 * status system; audited specifically as sound.publish/sound.unpublish when
 * that's the only field that changed, sound.update otherwise.
 */
export const adminUpdateSound = onCall<AdminUpdateSoundRequest, Promise<AdminUpdateSoundResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'sounds.write');
    const data = request.data ?? ({} as AdminUpdateSoundRequest);

    if (typeof data.soundId !== 'string' || data.soundId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing sound reference.');
    }

    const ref = db.collection('sounds').doc(data.soundId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', "We couldn't find that sound.");
    }
    const current = snap.data()!;

    const updates: Record<string, unknown> = {};
    const changes: string[] = [];

    if (data.title !== undefined) {
      const title = data.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (!title) {
        throw new HttpsError('invalid-argument', 'Title cannot be empty.');
      }
      if (title !== current.title) {
        updates.title = title;
        updates.titleLower = title.toLowerCase();
        changes.push('title updated');
      }
    }
    if (data.artist !== undefined) updates.artist = data.artist.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.album !== undefined) updates.album = data.album.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.genre !== undefined) updates.genre = data.genre.trim().slice(0, MAX_TAG_LENGTH) || FieldValue.delete();
    if (data.categoryIds !== undefined) {
      const categoryIds = Array.isArray(data.categoryIds) ? [...new Set(data.categoryIds.filter((id) => typeof id === 'string'))] : [];
      updates.categoryIds = categoryIds.length > 0 ? categoryIds : FieldValue.delete();
      changes.push('categories updated');
    }

    let visibilityOnlyChange = false;
    if (data.visibility !== undefined) {
      if (!VISIBILITIES.includes(data.visibility)) {
        throw new HttpsError('invalid-argument', 'Invalid visibility.');
      }
      if (data.visibility !== current.visibility) {
        updates.visibility = data.visibility;
        changes.push(`visibility: ${current.visibility} → ${data.visibility}`);
        visibilityOnlyChange = Object.keys(updates).length === 1 && data.artworkUploadId === undefined;
      }
    }

    if (data.artworkUploadId) {
      const uploadSnap = await db.collection('mediaUploads').doc(data.artworkUploadId).get();
      const upload = uploadSnap.data();
      if (!uploadSnap.exists || upload?.uid !== admin.uid || upload?.status !== 'uploaded' || upload?.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "That artwork hasn't finished uploading. Please try again.");
      }
      updates.artworkUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
      updates.artworkStoragePath = upload.storageKey;
      changes.push('cover replaced');
    }

    if (Object.keys(updates).length === 0) {
      return {soundId: ref.id};
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    await ref.update(updates);

    const action = visibilityOnlyChange ? (data.visibility === 'public' ? 'sound.publish' : 'sound.unpublish') : 'sound.update';
    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action,
      targetType: 'sound',
      targetId: ref.id,
      reason: changes.join('; ') || null,
    }).catch(() => {});

    return {soundId: ref.id};
  },
);
