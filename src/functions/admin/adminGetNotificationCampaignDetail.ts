import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminNotificationCampaignListItem} from './adminListNotificationCampaigns';

export interface AdminNotificationCampaignDetail extends AdminNotificationCampaignListItem {
  body: string;
}

interface AdminGetNotificationCampaignDetailRequest {
  campaignId: string;
}

export const adminGetNotificationCampaignDetail = onCall<AdminGetNotificationCampaignDetailRequest, Promise<AdminNotificationCampaignDetail>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    await requireActiveAdmin(request, 'notifications.read');

    const campaignId = request.data?.campaignId;
    if (typeof campaignId !== 'string' || campaignId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing campaignId.');
    }

    const snap = await db.collection('adminAuditLogs').doc(campaignId).get();
    if (!snap.exists || snap.data()?.action !== 'notification.send') {
      throw new HttpsError('not-found', 'This notification could not be found.');
    }

    const data = snap.data()!;
    const metadata = (data.metadata as Record<string, unknown>) ?? {};

    return {
      id: snap.id,
      title: (metadata.title as string) ?? '',
      body: (metadata.body as string) ?? '',
      audienceType: (metadata.audienceType as AdminNotificationCampaignDetail['audienceType']) ?? 'all',
      targetUserId: (metadata.targetUserId as string) ?? null,
      recipientCount: typeof metadata.recipientCount === 'number' ? metadata.recipientCount : 0,
      failureCount: typeof metadata.failureCount === 'number' ? metadata.failureCount : 0,
      actorEmail: (data.actorEmail as string) ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  },
);
