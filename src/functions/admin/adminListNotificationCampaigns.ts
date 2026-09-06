import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminNotificationCampaignListItem {
  id: string;
  title: string;
  audienceType: 'all' | 'active' | 'user';
  targetUserId: string | null;
  recipientCount: number;
  failureCount: number;
  actorEmail: string | null;
  createdAt: string | null;
}

interface AdminListNotificationCampaignsRequest {
  pageSize?: number;
  cursor?: string;
}

interface AdminListNotificationCampaignsResponse {
  campaigns: AdminNotificationCampaignListItem[];
  nextCursor: string | null;
}

/**
 * Reuses adminAuditLogs as the campaign-history source of truth (Decision 6
 * in the Module 08 plan) rather than a second collection — every "send"
 * already writes one entry here via writeAuditLog's new `metadata`/`docId`
 * support.
 */
export const adminListNotificationCampaigns = onCall<AdminListNotificationCampaignsRequest, Promise<AdminListNotificationCampaignsResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    await requireActiveAdmin(request, 'notifications.read');

    const pageSize = clampLimit(request.data?.pageSize, 50, 20);
    const cursor = request.data?.cursor;

    let q = db.collection('adminAuditLogs').where('action', '==', 'notification.send').orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('adminAuditLogs').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const campaigns: AdminNotificationCampaignListItem[] = snap.docs.map((doc) => {
      const data = doc.data();
      const metadata = (data.metadata as Record<string, unknown>) ?? {};
      return {
        id: doc.id,
        title: (metadata.title as string) ?? '',
        audienceType: (metadata.audienceType as AdminNotificationCampaignListItem['audienceType']) ?? 'all',
        targetUserId: (metadata.targetUserId as string) ?? null,
        recipientCount: typeof metadata.recipientCount === 'number' ? metadata.recipientCount : 0,
        failureCount: typeof metadata.failureCount === 'number' ? metadata.failureCount : 0,
        actorEmail: (data.actorEmail as string) ?? null,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      };
    });
    const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

    return {campaigns, nextCursor};
  },
);
