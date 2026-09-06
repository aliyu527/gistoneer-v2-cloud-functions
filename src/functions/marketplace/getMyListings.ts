import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';

export interface MyListingItem {
  id: string;
  type: 'product' | 'service';
  title: string;
  status: string;
  media: {url: string; thumbnailUrl?: string}[];
  price: number | null;
  createdAt: string | null;
}

interface GetMyListingsRequest {
  pageSize?: number;
  cursor?: string;
}

interface GetMyListingsResponse {
  listings: MyListingItem[];
  nextCursor: string | null;
}

/** The owner's own "My Shop" listing management view — every status included (draft/published/suspended/archived), unlike searchListings' public-only filter. */
export const getMyListings = onCall<GetMyListingsRequest, Promise<GetMyListingsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);
  const cursor = request.data?.cursor;

  let q = db.collection('listings').where('vendorId', '==', uid).orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);
  if (cursor) {
    const cursorSnap = await db.collection('listings').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const listings: MyListingItem[] = snap.docs.map((doc) => {
    const data = doc.data();
    const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];
    return {
      id: doc.id,
      type: (data.type as MyListingItem['type']) ?? 'product',
      title: (data.title as string) ?? '',
      status: (data.status as string) ?? '',
      media: media.slice(0, 1).map((item) => ({url: (item.url as string) ?? '', thumbnailUrl: item.thumbnailUrl as string | undefined})),
      price: typeof data.price === 'number' ? data.price : null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  });
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {listings, nextCursor};
});
