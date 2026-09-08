import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toReportListItem, type AdminReportListItem} from './adminListReports';

interface ReportsOverviewResponse {
  pendingCount: number;
  resolvedCount: number;
  dismissedCount: number;
  recentPending: AdminReportListItem[];
}

/** Every count is a Firestore count() aggregation query (mirrors adminGetMarketplaceOverview.ts) — never a full collection download. */
export const adminGetReportsOverview = onCall<undefined, Promise<ReportsOverviewResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'reports.read');

  const [pendingSnap, resolvedSnap, dismissedSnap, recentPendingSnap] = await Promise.all([
    db.collection('reports').where('status', '==', 'pending').count().get(),
    db.collection('reports').where('status', '==', 'resolved').count().get(),
    db.collection('reports').where('status', '==', 'dismissed').count().get(),
    db.collection('reports').where('status', '==', 'pending').orderBy('createdAt', 'desc').limit(10).get(),
  ]);

  return {
    pendingCount: pendingSnap.data().count,
    resolvedCount: resolvedSnap.data().count,
    dismissedCount: dismissedSnap.data().count,
    recentPending: recentPendingSnap.docs.map(toReportListItem),
  };
});
