import {onCall, HttpsError} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {isValidCategory} from '../../marketplace/service';

export interface PublicListingItem {
  id: string;
  vendorId: string;
  vendorShopName: string | null;
  vendorLogoUrl: string | null;
  type: 'product' | 'service';
  title: string;
  category: string;
  media: {url: string; thumbnailUrl?: string}[];
  location: {name: string} | null;
  price: number | null;
  currency: string | null;
  pricingModel: string | null;
  rate: number | null;
  createdAt: string | null;
}

interface SearchListingsRequest {
  type: 'product' | 'service';
  category?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface SearchListingsResponse {
  listings: PublicListingItem[];
  nextCursor: string | null;
}

function toPublicListingItem(doc: FirebaseFirestore.QueryDocumentSnapshot): PublicListingItem {
  const data = doc.data();
  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];
  return {
    id: doc.id,
    vendorId: (data.vendorId as string) ?? '',
    vendorShopName: (data.vendorShopName as string) ?? null,
    vendorLogoUrl: (data.vendorLogoUrl as string) ?? null,
    type: (data.type as PublicListingItem['type']) ?? 'product',
    title: (data.title as string) ?? '',
    category: (data.category as string) ?? '',
    media: media.slice(0, 1).map((item) => ({url: (item.url as string) ?? '', thumbnailUrl: item.thumbnailUrl as string | undefined})),
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    price: typeof data.price === 'number' ? data.price : null,
    currency: (data.currency as string) ?? null,
    pricingModel: (data.pricingModel as string) ?? null,
    rate: typeof data.rate === 'number' ? data.rate : null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Public browse/search — always `status=='published'` AND the denormalized
 * `vendorStatus=='approved'` (a suspended vendor's listings must not
 * surface here, and Firestore can't join to check the vendor doc's live
 * status in a query, hence the denormalized field kept in sync by
 * cascadeVendorStatusToListings). No free-text title search — no
 * `titleLower` mirror field exists, same class of limitation as posts'
 * caption search (Module 05) and sounds' title search (Module 06).
 */
export const searchListings = onCall<SearchListingsRequest, Promise<SearchListingsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }

  const {type, category, sortDir = 'desc', cursor} = request.data ?? ({} as SearchListingsRequest);
  if (type !== 'product' && type !== 'service') {
    throw new HttpsError('invalid-argument', 'Invalid listing type.');
  }
  if (category !== undefined && !isValidCategory(category)) {
    throw new HttpsError('invalid-argument', 'Invalid category.');
  }
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db
    .collection('listings')
    .where('type', '==', type)
    .where('status', '==', 'published')
    .where('vendorStatus', '==', 'approved');
  if (category) {
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
  const listings = snap.docs.map(toPublicListingItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {listings, nextCursor};
});
