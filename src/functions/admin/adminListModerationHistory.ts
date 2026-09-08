import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminAuditAction} from './writeAuditLog';

/** Everything in adminAuditLogs EXCEPT notification-campaign entries (Module 08's 'notification.send') — those aren't moderation actions and would be clutter on this page. */
export const MODERATION_ACTIONS: AdminAuditAction[] = [
  'user.suspend',
  'user.unsuspend',
  'user.warn',
  'content.hide',
  'content.restore',
  'content.remove',
  'comment.hide',
  'comment.restore',
  'sound.hide',
  'sound.restore',
  'sound.remove',
  'live.end',
  'vendor.approve',
  'vendor.reject',
  'vendor.suspend',
  'vendor.restore',
  'listing.suspend',
  'listing.restore',
  'report.dismiss',
];

export interface AdminModerationHistoryItem {
  id: string;
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string | null;
}

interface AdminListModerationHistoryRequest {
  action?: AdminAuditAction;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListModerationHistoryResponse {
  entries: AdminModerationHistoryItem[];
  nextCursor: string | null;
}

/**
 * Reuses adminAuditLogs directly (Decision 9) rather than a second history
 * collection — every entry here already exists regardless of whether the
 * action came from a report or straight from its own module page. Default
 * view (no `action` filter) uses `action IN [...moderation actions]`,
 * which Firestore serves off the exact same (action, createdAt) composite
 * index already deployed for Module 08's adminListNotificationCampaigns —
 * no new index needed for either the default or the narrowed view.
 */
export const adminListModerationHistory = onCall<AdminListModerationHistoryRequest, Promise<AdminListModerationHistoryResponse>>(
  {cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10},
  async (request) => {
    await requireActiveAdmin(request, 'reports.read');

    const {action, sortDir = 'desc', cursor} = request.data ?? {};
    const pageSize = clampLimit(request.data?.pageSize, 50, 20);

    let q: Query<DocumentData> = action
      ? db.collection('adminAuditLogs').where('action', '==', action)
      : db.collection('adminAuditLogs').where('action', 'in', MODERATION_ACTIONS);
    q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('adminAuditLogs').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const entries: AdminModerationHistoryItem[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        actorEmail: (data.actorEmail as string) ?? null,
        action: data.action as AdminAuditAction,
        targetType: (data.targetType as string) ?? '',
        targetId: (data.targetId as string) ?? '',
        reason: (data.reason as string) ?? null,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      };
    });
    const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

    return {entries, nextCursor};
  },
);
