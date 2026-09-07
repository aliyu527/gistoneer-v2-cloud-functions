import {onCall} from 'firebase-functions/v2/https';
import {AggregateField} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

interface NotificationAnalyticsResponse {
  campaignsSent: number;
  recipientsNotified: number;
}

/**
 * Reuses the exact `adminAuditLogs(action, createdAt)` composite index
 * Module 08's adminListNotificationCampaigns.ts already relies on — no new
 * index needed. recipientsNotified sums the same metadata.recipientCount
 * field written there. No delivered/opened metrics: per-recipient
 * notification docs never store a queryable campaignId field (only this
 * audit-log entry does), so there's no way to query "how many of this
 * campaign's docs have isRead==true" without knowing every recipient's uid
 * in advance — a real, disclosed gap, not fabricated.
 */
export const getNotificationAnalytics = onCall<DashboardRangeInput, Promise<NotificationAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});

  const snap = await db
    .collection('adminAuditLogs')
    .where('action', '==', 'notification.send')
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .aggregate({
      campaignsSent: AggregateField.count(),
      recipientsNotified: AggregateField.sum('metadata.recipientCount'),
    })
    .get();

  const data = snap.data();
  return {
    campaignsSent: data.campaignsSent ?? 0,
    recipientsNotified: data.recipientsNotified ?? 0,
  };
});
