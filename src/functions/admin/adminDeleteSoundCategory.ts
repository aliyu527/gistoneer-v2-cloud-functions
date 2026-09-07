import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminDeleteSoundCategoryRequest {
  categoryId: string;
}

interface AdminDeleteSoundCategoryResponse {
  deleted: true;
}

/**
 * Hard delete only when zero sounds currently reference the category
 * (checked via a count() on categoryIds array-contains) — otherwise the
 * caller should deactivate instead (adminUpdateSoundCategory's isActive
 * flip), matching §40's category-delete-safety guidance without building a
 * reassignment workflow nothing else here needs.
 */
export const adminDeleteSoundCategory = onCall<AdminDeleteSoundCategoryRequest, Promise<AdminDeleteSoundCategoryResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'sounds.categories.manage');
    const categoryId = request.data?.categoryId;
    if (typeof categoryId !== 'string' || categoryId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing category reference.');
    }

    const ref = db.collection('soundCategories').doc(categoryId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'This category could not be found.');
    }

    const usageSnap = await db.collection('sounds').where('categoryIds', 'array-contains', categoryId).count().get();
    if (usageSnap.data().count > 0) {
      throw new HttpsError('failed-precondition', 'This category still has sounds assigned to it. Deactivate it instead, or remove it from those sounds first.');
    }

    const data = snap.data()!;
    await Promise.all([ref.delete(), db.collection('soundCategorySlugs').doc(data.slug).delete()]);

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'category.update',
      targetType: 'category',
      targetId: categoryId,
      reason: `Deleted category: ${data.name}`,
    }).catch(() => {});

    return {deleted: true};
  },
);
