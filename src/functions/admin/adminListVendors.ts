import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export type VendorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface AdminVendorListItem {
  id: string;
  shopName: string;
  status: VendorStatus;
  categories: string[];
  location: {name: string} | null;
  logoUrl: string | null;
  createdAt: string | null;
  reviewedAt: string | null;
}

interface AdminListVendorsRequest {
  status?: VendorStatus;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListVendorsResponse {
  vendors: AdminVendorListItem[];
  nextCursor: string | null;
}

export function toVendorListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminVendorListItem {
  const data = doc.data();
  return {
    id: doc.id,
    shopName: (data.shopName as string) ?? '',
    status: (data.status as VendorStatus) ?? 'pending',
    categories: Array.isArray(data.categories) ? (data.categories as string[]) : [],
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    logoUrl: (data.logoUrl as string) ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    reviewedAt: data.reviewedAt?.toDate?.().toISOString() ?? null,
  };
}

/** One list serves both the "Vendor Applications" queue (status=='pending') and the general "Vendors" view (approved/suspended/rejected) — vendors is a single collection per Decision 1, not split into applications+shops. */
export const adminListVendors = onCall<AdminListVendorsRequest, Promise<AdminListVendorsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const {status, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('vendors');
  if (status) {
    q = q.where('status', '==', status);
  }
  q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('vendors').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const vendors = snap.docs.map(toVendorListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {vendors, nextCursor};
});
