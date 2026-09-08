/**
 * Extracted from adminListVendors.ts when that function was migrated to a
 * direct Firestore read (admin panel Cloud Run cost-reduction migration) —
 * adminSearchVendors.ts and adminGetVendorDetail.ts still need this shape,
 * so it lives here now instead of being deleted along with the list
 * callable itself.
 */
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
