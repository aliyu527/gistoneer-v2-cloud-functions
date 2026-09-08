import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminVendorListItem} from './adminVendorShared';

export interface AdminVendorDetail extends AdminVendorListItem {
  description: string;
  businessType: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  coverUrl: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  listingCount: number;
  publishedListingCount: number;
  userStatus: 'active' | 'suspended' | null;
  username: string | null;
}

interface AdminGetVendorDetailRequest {
  vendorId: string;
}

export const adminGetVendorDetail = onCall<AdminGetVendorDetailRequest, Promise<AdminVendorDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const vendorId = request.data?.vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing vendorId.');
  }

  const snap = await db.collection('vendors').doc(vendorId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This vendor could not be found.');
  }
  const data = snap.data()!;

  const [userSnap, listingCountSnap, publishedCountSnap] = await Promise.all([
    db.collection('users').doc(vendorId).get(),
    db.collection('listings').where('vendorId', '==', vendorId).count().get(),
    db.collection('listings').where('vendorId', '==', vendorId).where('status', '==', 'published').count().get(),
  ]);
  const userData = userSnap.data();

  return {
    id: snap.id,
    shopName: (data.shopName as string) ?? '',
    status: (data.status as AdminVendorDetail['status']) ?? 'pending',
    categories: Array.isArray(data.categories) ? (data.categories as string[]) : [],
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    logoUrl: (data.logoUrl as string) ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    reviewedAt: data.reviewedAt?.toDate?.().toISOString() ?? null,
    description: (data.description as string) ?? '',
    businessType: (data.businessType as string) ?? null,
    contactEmail: (data.contactEmail as string) ?? null,
    contactPhone: (data.contactPhone as string) ?? null,
    coverUrl: (data.coverUrl as string) ?? null,
    reviewedBy: (data.reviewedBy as string) ?? null,
    rejectionReason: (data.rejectionReason as string) ?? null,
    listingCount: listingCountSnap.data().count,
    publishedListingCount: publishedCountSnap.data().count,
    userStatus: userSnap.exists ? ((userData?.status as 'active' | 'suspended') ?? 'active') : null,
    username: (userData?.username as string) ?? null,
  };
});
