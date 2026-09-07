import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;

interface AdminCreateSoundCategoryRequest {
  name?: string;
  description?: string;
  /** A confirmed image upload (mediaUploads) — never a raw client-supplied URL, same posture as updateSound.ts's artwork handling. */
  imageUploadId?: string;
  sortOrder?: number;
}

interface AdminCreateSoundCategoryResponse {
  id: string;
  slug: string;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Categories are ordinary admin-managed records — "Trending"/"Featured"/
 * "Popular" are created here exactly like "Afrobeats"/"Gospel" would be,
 * using three reserved slugs (trending/featured/popular) the real catalog
 * provider (firestoreCatalogProvider.ts) looks up by slug. Slug is derived
 * from name and immutable once set (§24) — a soundCategorySlugs/{slug}
 * uniqueness doc, same transaction shape as reserveUsernameForUid.
 */
export const adminCreateSoundCategory = onCall<AdminCreateSoundCategoryRequest, Promise<AdminCreateSoundCategoryResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'sounds.categories.manage');
    const data = request.data ?? {};

    const name = (data.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) {
      throw new HttpsError('invalid-argument', 'Category name is required.');
    }
    const slug = slugify(name);
    if (!slug) {
      throw new HttpsError('invalid-argument', 'Enter a valid category name.');
    }
    const description = (data.description ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH);
    const sortOrder = Number.isFinite(data.sortOrder) ? Math.trunc(data.sortOrder as number) : 0;

    let imageUrl: string | undefined;
    if (data.imageUploadId) {
      const uploadSnap = await db.collection('mediaUploads').doc(data.imageUploadId).get();
      const upload = uploadSnap.data();
      if (!uploadSnap.exists || upload?.uid !== admin.uid || upload?.status !== 'uploaded' || upload?.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "That image hasn't finished uploading. Please try again.");
      }
      imageUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
    }

    const ref = db.collection('soundCategories').doc();
    const slugRef = db.collection('soundCategorySlugs').doc(slug);

    await db.runTransaction(async (tx) => {
      const slugDoc = await tx.get(slugRef);
      if (slugDoc.exists) {
        throw new HttpsError('already-exists', 'A category with that name already exists.');
      }
      tx.set(slugRef, {categoryId: ref.id, createdAt: FieldValue.serverTimestamp()});
      tx.set(ref, {
        id: ref.id,
        name,
        slug,
        ...(description ? {description} : {}),
        ...(imageUrl ? {imageUrl} : {}),
        isActive: true,
        sortOrder,
        createdBy: admin.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'category.create',
      targetType: 'category',
      targetId: ref.id,
      reason: `Created category: ${name}`,
    }).catch(() => {});

    return {id: ref.id, slug};
  },
);
