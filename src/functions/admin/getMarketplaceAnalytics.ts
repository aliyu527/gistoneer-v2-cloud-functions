import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

interface MarketplaceAnalyticsResponse {
  newVendors: number;
  newListings: number;
}

/**
 * The one thing adminGetMarketplaceOverview.ts (Module 09, reused as-is for
 * this page's "current state" panel) doesn't already provide: range-scoped
 * new-vendor/new-listing counts. Single-field range queries, no index
 * needed. No transaction/revenue metrics — Module 09 explicitly has no
 * checkout/payments/orders, so there's nothing real to report there.
 */
export const getMarketplaceAnalytics = onCall<DashboardRangeInput, Promise<MarketplaceAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});

  const [newVendorsSnap, newListingsSnap] = await Promise.all([
    db.collection('vendors').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
    db.collection('listings').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
  ]);

  return {
    newVendors: newVendorsSnap.data().count,
    newListings: newListingsSnap.data().count,
  };
});
