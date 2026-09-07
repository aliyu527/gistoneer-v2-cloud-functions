import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {ReportStatus} from './adminListReports';
import type {ReportTargetType} from '../../reports/service';

export interface AdminReportDetail {
  id: string;
  reporterId: string;
  reporterUsername: string | null;
  targetType: ReportTargetType;
  targetId: string;
  context: {postId?: string} | null;
  reason: string;
  description: string | null;
  status: ReportStatus;
  targetSnapshot: {label: string; ownerId?: string};
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  actionTaken: string | null;
  /** Other pending reports against the exact same target — the duplicate-grouping signal (Decision 1: a live count, not a moderation-case collection). */
  duplicateCount: number;
}

interface AdminGetReportDetailRequest {
  reportId: string;
}

/** Reporter identity is included here for the investigating admin only — this response is never surfaced to the reported party (see Decision matching spec §80). */
export const adminGetReportDetail = onCall<AdminGetReportDetailRequest, Promise<AdminReportDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'reports.read');

  const reportId = request.data?.reportId;
  if (typeof reportId !== 'string' || reportId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing reportId.');
  }

  const snap = await db.collection('reports').doc(reportId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This report could not be found.');
  }
  const data = snap.data()!;

  const [reporterSnap, duplicateCountSnap] = await Promise.all([
    db.collection('users').doc(data.reporterId as string).get(),
    db
      .collection('reports')
      .where('targetType', '==', data.targetType)
      .where('targetId', '==', data.targetId)
      .where('status', '==', 'pending')
      .count()
      .get(),
  ]);

  // Exclude this report itself from its own duplicate count when it's still pending.
  const rawDuplicateCount = duplicateCountSnap.data().count;
  const duplicateCount = data.status === 'pending' ? Math.max(0, rawDuplicateCount - 1) : rawDuplicateCount;

  return {
    id: snap.id,
    reporterId: data.reporterId as string,
    reporterUsername: (reporterSnap.data()?.username as string) ?? null,
    targetType: (data.targetType as ReportTargetType) ?? 'post',
    targetId: (data.targetId as string) ?? '',
    context: data.context ? {postId: data.context.postId as string | undefined} : null,
    reason: (data.reason as string) ?? '',
    description: (data.description as string) ?? null,
    status: (data.status as ReportStatus) ?? 'pending',
    targetSnapshot: {
      label: (data.targetSnapshot?.label as string) ?? '',
      ownerId: data.targetSnapshot?.ownerId as string | undefined,
    },
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    resolvedAt: data.resolvedAt?.toDate?.().toISOString() ?? null,
    resolvedBy: (data.resolvedBy as string) ?? null,
    resolution: (data.resolution as string) ?? null,
    actionTaken: (data.actionTaken as string) ?? null,
    duplicateCount,
  };
});
