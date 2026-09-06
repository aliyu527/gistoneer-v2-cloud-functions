import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';

interface ListingDetailMedia {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface ListingDetail {
  id: string;
  vendorId: string;
  type: 'product' | 'service';
  title: string;
  description: string;
  category: string;
  media: ListingDetailMedia[];
  location: {name: string} | null;
  status: string;
  price: number | null;
  currency: string | null;
  condition: string | null;
  quantity: number | null;
  pricingModel: string | null;
  rate: number | null;
  skills: string[];
  createdAt: string | null;
  vendor: {
    shopName: string;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  } | null;
}

interface GetListingDetailRequest {
  listingId: string;
}

/** Owner can always view their own (any status); anyone else only if published + vendor approved — same visibility rule enforced here as the Firestore rule, since this callable's whole point is to also resolve the vendor's live contact info (not denormalized onto the listing). */
export const getListingDetail = onCall<GetListingDetailRequest, Promise<ListingDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;

  const listingId = request.data?.listingId;
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing listingId.');
  }

  const snap = await db.collection('listings').doc(listingId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }
  const data = snap.data()!;
  const isOwner = data.vendorId === uid;
  const isPubliclyVisible = data.status === 'published' && (data.vendorStatus ?? 'approved') === 'approved';
  if (!isOwner && !isPubliclyVisible) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }

  const vendorSnap = await db.collection('vendors').doc(data.vendorId as string).get();
  const vendorData = vendorSnap.data();

  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];

  return {
    id: snap.id,
    vendorId: data.vendorId as string,
    type: (data.type as ListingDetail['type']) ?? 'product',
    title: (data.title as string) ?? '',
    description: (data.description as string) ?? '',
    category: (data.category as string) ?? '',
    media: media.map((item) => ({
      url: (item.url as string) ?? '',
      thumbnailUrl: item.thumbnailUrl as string | undefined,
      width: item.width as number | undefined,
      height: item.height as number | undefined,
    })),
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    status: (data.status as string) ?? '',
    price: typeof data.price === 'number' ? data.price : null,
    currency: (data.currency as string) ?? null,
    condition: (data.condition as string) ?? null,
    quantity: typeof data.quantity === 'number' ? data.quantity : null,
    pricingModel: (data.pricingModel as string) ?? null,
    rate: typeof data.rate === 'number' ? data.rate : null,
    skills: Array.isArray(data.skills) ? (data.skills as string[]) : [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    vendor: vendorSnap.exists
      ? {
          shopName: (vendorData?.shopName as string) ?? '',
          logoUrl: (vendorData?.logoUrl as string) ?? null,
          contactEmail: (vendorData?.contactEmail as string) ?? null,
          contactPhone: (vendorData?.contactPhone as string) ?? null,
        }
      : null,
  };
});
