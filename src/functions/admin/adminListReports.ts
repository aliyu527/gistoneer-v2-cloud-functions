import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {ReportTargetType} from '../../reports/service';

export type ReportStatus = 'pending' | 'resolved' | 'dismissed';

export interface AdminReportListItem {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  targetSnapshot: {label: string; ownerId?: string};
  createdAt: string | null;
}

interface AdminListReportsRequest {
  status?: ReportStatus;
  targetType?: ReportTargetType;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListReportsResponse {
  reports: AdminReportListItem[];
  nextCursor: string | null;
}

export function toReportListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminReportListItem {
  const data = doc.data();
  return {
    id: doc.id,
    targetType: (data.targetType as ReportTargetType) ?? 'post',
    targetId: (data.targetId as string) ?? '',
    reason: (data.reason as string) ?? '',
    status: (data.status as ReportStatus) ?? 'pending',
    targetSnapshot: {
      label: (data.targetSnapshot?.label as string) ?? '',
      ownerId: data.targetSnapshot?.ownerId as string | undefined,
    },
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/** Defaults to the pending queue when no status filter is given — `/reports/list` in the admin is both "the queue" and the general reports table (Decision 8: no separate Moderation Queue page). Filters applied one at a time (status > targetType), matching the established index discipline (adminListListings/adminListVendors). */
export const adminListReports = onCall<AdminListReportsRequest, Promise<AdminListReportsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'reports.read');

  const {status, targetType, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('reports');
  if (status) {
    q = q.where('status', '==', status);
  } else if (targetType) {
    q = q.where('targetType', '==', targetType);
  }
  q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('reports').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const reports = snap.docs.map(toReportListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {reports, nextCursor};
});
