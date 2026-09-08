import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';

interface RecentVendorApplication {
  uid: string;
  shopName: string;
  createdAt: string | null;
}

interface RecentListing {
  id: string;
  title: string;
  type: 'product' | 'service';
  vendorShopName: string | null;
  createdAt: string | null;
}

interface MarketplaceOverviewResponse {
  totalVendors: number;
  pendingApplications: number;
  approvedVendors: number;
  suspendedVendors: number;
  totalListings: number;
  publishedListings: number;
  draftListings: number;
  suspendedListings: number;
  recentApplications: RecentVendorApplication[];
  recentPublishedListings: RecentListing[];
  recentSuspendedListings: RecentListing[];
}

/**
 * Every number is a Firestore count() aggregation query (same posture as
 * getDashboardOverview.ts) — never a full collection download. The three
 * "recent" lists reuse the existing vendors(status,createdAt) and
 * listings(status,createdAt) composite indexes already deployed for the
 * list pages, so no new index was needed for this dashboard.
 */
export const adminGetMarketplaceOverview = onCall<undefined, Promise<MarketplaceOverviewResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const [
    totalVendorsSnap,
    pendingApplicationsSnap,
    approvedVendorsSnap,
    suspendedVendorsSnap,
    totalListingsSnap,
    publishedListingsSnap,
    draftListingsSnap,
    suspendedListingsSnap,
    recentApplicationsSnap,
    recentPublishedListingsSnap,
    recentSuspendedListingsSnap,
  ] = await Promise.all([
    db.collection('vendors').count().get(),
    db.collection('vendors').where('status', '==', 'pending').count().get(),
    db.collection('vendors').where('status', '==', 'approved').count().get(),
    db.collection('vendors').where('status', '==', 'suspended').count().get(),
    db.collection('listings').count().get(),
    db.collection('listings').where('status', '==', 'published').count().get(),
    db.collection('listings').where('status', '==', 'draft').count().get(),
    db.collection('listings').where('status', '==', 'suspended').count().get(),
    db.collection('vendors').where('status', '==', 'pending').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('listings').where('status', '==', 'published').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('listings').where('status', '==', 'suspended').orderBy('createdAt', 'desc').limit(5).get(),
  ]);

  const toListing = (doc: FirebaseFirestore.QueryDocumentSnapshot): RecentListing => {
    const data = doc.data();
    return {
      id: doc.id,
      title: (data.title as string) ?? '',
      type: (data.type as RecentListing['type']) ?? 'product',
      vendorShopName: (data.vendorShopName as string) ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  };

  return {
    totalVendors: totalVendorsSnap.data().count,
    pendingApplications: pendingApplicationsSnap.data().count,
    approvedVendors: approvedVendorsSnap.data().count,
    suspendedVendors: suspendedVendorsSnap.data().count,
    totalListings: totalListingsSnap.data().count,
    publishedListings: publishedListingsSnap.data().count,
    draftListings: draftListingsSnap.data().count,
    suspendedListings: suspendedListingsSnap.data().count,
    recentApplications: recentApplicationsSnap.docs.map((doc) => ({
      uid: doc.id,
      shopName: (doc.data().shopName as string) ?? '',
      createdAt: doc.data().createdAt?.toDate?.().toISOString() ?? null,
    })),
    recentPublishedListings: recentPublishedListingsSnap.docs.map(toListing),
    recentSuspendedListings: recentSuspendedListingsSnap.docs.map(toListing),
  };
});
