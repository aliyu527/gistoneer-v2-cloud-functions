import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminSoundCategoryItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AdminListSoundCategoriesResponse {
  categories: AdminSoundCategoryItem[];
}

/** No pagination — categories are a small, admin-curated set (unlike sounds/users), same "load them all, sort client-side" posture as the existing permission list this session already established for small reference sets. */
export const adminListSoundCategories = onCall<undefined, Promise<AdminListSoundCategoriesResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'sounds.read');

  const snap = await db.collection('soundCategories').orderBy('sortOrder', 'asc').get();
  const categories: AdminSoundCategoryItem[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      imageUrl: data.imageUrl ?? null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdBy: data.createdBy ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    };
  });

  return {categories};
});
