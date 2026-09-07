import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {Timestamp, type Query, type DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminAuditAction} from './writeAuditLog';

type AuditTargetType = 'user' | 'content' | 'sound' | 'live' | 'notification' | 'vendor' | 'listing' | 'comment' | 'report' | 'admin' | 'settings';

export interface AdminAuditLogItem {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
}

interface AdminListAuditLogsRequest {
  action?: AdminAuditAction;
  targetType?: AuditTargetType;
  actorEmail?: string;
  dateFrom?: string;
  dateTo?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListAuditLogsResponse {
  entries: AdminAuditLogItem[];
  nextCursor: string | null;
}

/**
 * Module 14 Objective 1 — the real, full audit-log viewer, reading the exact
 * same adminAuditLogs collection ModerationHistoryPage/SettingsHistoryPage
 * already read from (third reader, not a second logging system). Filters
 * are mutually exclusive by design (at most one of action/targetType/
 * actorEmail at a time, same single-dropdown UI pattern as
 * adminListModerationHistory.ts) so each combination maps onto exactly one
 * of the three deployed composite indexes (action+createdAt already existed;
 * targetType+createdAt and actorEmail+createdAt are new this module) instead
 * of needing a combinatorial index for every possible filter pairing.
 */
export const adminListAuditLogs = onCall<AdminListAuditLogsRequest, Promise<AdminListAuditLogsResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    await requireActiveAdmin(request, 'audit.read');

    const {action, targetType, actorEmail, dateFrom, dateTo, sortDir = 'desc', cursor} = request.data ?? {};
    const pageSize = clampLimit(request.data?.pageSize, 50, 20);

    const activeFilters = [action, targetType, actorEmail].filter((v) => v !== undefined && v !== '');
    if (activeFilters.length > 1) {
      throw new HttpsError('invalid-argument', 'Only one of action, targetType, or actorEmail may be filtered at a time.');
    }

    let q: Query<DocumentData> = db.collection('adminAuditLogs');
    if (action) {
      q = q.where('action', '==', action);
    } else if (targetType) {
      q = q.where('targetType', '==', targetType);
    } else if (actorEmail) {
      q = q.where('actorEmail', '==', actorEmail);
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      if (Number.isNaN(from.getTime())) {
        throw new HttpsError('invalid-argument', 'Invalid dateFrom.');
      }
      q = q.where('createdAt', '>=', Timestamp.fromDate(from));
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (Number.isNaN(to.getTime())) {
        throw new HttpsError('invalid-argument', 'Invalid dateTo.');
      }
      q = q.where('createdAt', '<=', Timestamp.fromDate(to));
    }

    q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('adminAuditLogs').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const entries: AdminAuditLogItem[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        actorUid: (data.actorUid as string) ?? '',
        actorEmail: (data.actorEmail as string) ?? null,
        action: data.action as AdminAuditAction,
        targetType: data.targetType as AuditTargetType,
        targetId: (data.targetId as string) ?? '',
        reason: (data.reason as string) ?? null,
        metadata: (data.metadata as Record<string, unknown>) ?? null,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      };
    });
    const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

    return {entries, nextCursor};
  },
);
