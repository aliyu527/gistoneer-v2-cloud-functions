import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;

interface AdminUpdateSoundCategoryRequest {
  categoryId: string;
  name?: string;
  description?: string;
  imageUploadId?: string;
  isActive?: boolean;
  sortOrder?: number;
}

interface AdminUpdateSoundCategoryResponse {
  id: string;
}

/** Slug is immutable once created (§24) — this never touches it, only name/description/image/isActive/sortOrder. Activate/deactivate through this same function (isActive flip), audited as category.activate/category.deactivate specifically when that's the only field that changed. */
export const adminUpdateSoundCategory = onCall<AdminUpdateSoundCategoryRequest, Promise<AdminUpdateSoundCategoryResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'sounds.categories.manage');
    const data = request.data ?? ({} as AdminUpdateSoundCategoryRequest);

    if (typeof data.categoryId !== 'string' || data.categoryId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing category reference.');
    }

    const ref = db.collection('soundCategories').doc(data.categoryId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'This category could not be found.');
    }
    const current = snap.data()!;

    const updates: Record<string, unknown> = {};
    const changes: string[] = [];

    if (data.name !== undefined) {
      const name = data.name.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) {
        throw new HttpsError('invalid-argument', 'Category name cannot be empty.');
      }
      if (name !== current.name) {
        updates.name = name;
        changes.push(`name: ${current.name} → ${name}`);
      }
    }
    if (data.description !== undefined) {
      updates.description = data.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || FieldValue.delete();
    }
    if (data.sortOrder !== undefined && Number.isFinite(data.sortOrder)) {
      updates.sortOrder = Math.trunc(data.sortOrder);
    }
    let isActiveOnlyChange = false;
    if (data.isActive !== undefined && data.isActive !== current.isActive) {
      updates.isActive = data.isActive;
      changes.push(`isActive: ${current.isActive} → ${data.isActive}`);
      isActiveOnlyChange = Object.keys(updates).length === 1 && data.imageUploadId === undefined;
    }
    if (data.imageUploadId) {
      const uploadSnap = await db.collection('mediaUploads').doc(data.imageUploadId).get();
      const upload = uploadSnap.data();
      if (!uploadSnap.exists || upload?.uid !== admin.uid || upload?.status !== 'uploaded' || upload?.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "That image hasn't finished uploading. Please try again.");
      }
      updates.imageUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
    }

    if (Object.keys(updates).length === 0) {
      return {id: ref.id};
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    await ref.update(updates);

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: isActiveOnlyChange ? (data.isActive ? 'category.activate' : 'category.deactivate') : 'category.update',
      targetType: 'category',
      targetId: ref.id,
      reason: changes.join('; ') || null,
    }).catch(() => {});

    return {id: ref.id};
  },
);
