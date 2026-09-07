import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminDismissReportRequest {
  reportId: string;
  reason: string;
}

interface AdminDismissReportResponse {
  reportId: string;
  status: 'dismissed';
}

/** No entity action is taken — just closes the report out. Requires only reports.resolve (not an action-specific permission, since nothing about the reported entity changes). */
export const adminDismissReport = onCall<AdminDismissReportRequest, Promise<AdminDismissReportResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'reports.resolve');

  const reportId = request.data?.reportId;
  const reason = request.data?.reason?.trim();
  if (typeof reportId !== 'string' || reportId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing reportId.');
  }
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const ref = db.collection('reports').doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This report could not be found.');
  }
  if (snap.data()?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only a pending report can be dismissed.');
  }

  await ref.update({
    status: 'dismissed',
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: admin.email,
    resolution: reason,
  });

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'report.dismiss',
    targetType: 'report',
    targetId: reportId,
    reason,
  }).catch(() => {});

  return {reportId, status: 'dismissed'};
});
