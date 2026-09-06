import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export type AdminListingStatus = 'draft' | 'published' | 'suspended' | 'archived';

export interface AdminListingListItem {
  id: string;
  vendorId: string;
  vendorShopName: string | null;
  type: 'product' | 'service';
  title: string;
  category: string;
  status: AdminListingStatus;
  media: {url: string; thumbnailUrl?: string}[];
  price: number | null;
  createdAt: string | null;
}

interface AdminListListingsRequest {
  type?: 'product' | 'service';
  category?: string;
  status?: AdminListingStatus;
  vendorId?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListListingsResponse {
  listings: AdminListingListItem[];
  nextCursor: string | null;
}

export function toAdminListingListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminListingListItem {
  const data = doc.data();
  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];
  return {
    id: doc.id,
    vendorId: (data.vendorId as string) ?? '',
    vendorShopName: (data.vendorShopName as string) ?? null,
    type: (data.type as AdminListingListItem['type']) ?? 'product',
    title: (data.title as string) ?? '',
    category: (data.category as string) ?? '',
    status: (data.status as AdminListingStatus) ?? 'draft',
    media: media.slice(0, 1).map((item) => ({url: (item.url as string) ?? '', thumbnailUrl: item.thumbnailUrl as string | undefined})),
    price: typeof data.price === 'number' ? data.price : null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Admin sees ALL listings regardless of vendor status (unlike the public
 * searchListings, which filters on the denormalized vendorStatus) — an
 * admin reviewing a suspended vendor's listings, or a still-draft listing,
 * needs full visibility. One filter at a time, matching the established
 * index discipline.
 */
export const adminListListings = onCall<AdminListListingsRequest, Promise<AdminListListingsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const {type, category, status, vendorId, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('listings');
  if (vendorId) {
    q = q.where('vendorId', '==', vendorId);
  } else if (status) {
    q = q.where('status', '==', status);
  } else if (type) {
    q = q.where('type', '==', type);
  } else if (category) {
    q = q.where('category', '==', category);
  }
  q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('listings').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const listings = snap.docs.map(toAdminListingListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {listings, nextCursor};
});
