import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdminAny} from './requireActiveAdmin';
import type {AdminAuditAction} from './writeAuditLog';

interface GetMyRecentAdminActivityRequest {
  pageSize?: number;
  cursor?: string;
}

export interface MyAdminActivityItem {
  id: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string | null;
}

interface GetMyRecentAdminActivityResponse {
  entries: MyAdminActivityItem[];
  nextCursor: string | null;
}

/** Force-filtered to the caller's own actorUid — works for every role including moderator/support, who lack audit.read and so can't use the full /audit-logs viewer. This is "my own activity," not a filtered view of the cross-admin trail, so no broader permission applies. */
export const getMyRecentAdminActivity = onCall<GetMyRecentAdminActivityRequest, Promise<GetMyRecentAdminActivityResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdminAny(request);
    const pageSize = clampLimit(request.data?.pageSize, 50, 10);
    const cursor = request.data?.cursor;

    let q = db.collection('adminAuditLogs').where('actorUid', '==', admin.uid).orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('adminAuditLogs').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const entries: MyAdminActivityItem[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
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
