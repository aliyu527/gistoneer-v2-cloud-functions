import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminAuditLogItem} from './adminListAuditLogs';

interface AdminGetAuditLogDetailRequest {
  logId: string;
}

/** Single-doc read of an adminAuditLogs entry — same shape adminListAuditLogs already returns, since the collection has no separate summary/detail split (every field is already safe to show in full). */
export const adminGetAuditLogDetail = onCall<AdminGetAuditLogDetailRequest, Promise<AdminAuditLogItem>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'audit.read');

  const logId = request.data?.logId;
  if (typeof logId !== 'string' || logId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing logId.');
  }

  const snap = await db.collection('adminAuditLogs').doc(logId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Audit log entry not found.');
  }
  const data = snap.data()!;

  return {
    id: snap.id,
    actorUid: (data.actorUid as string) ?? '',
    actorEmail: (data.actorEmail as string) ?? null,
    action: data.action,
    targetType: data.targetType,
    targetId: (data.targetId as string) ?? '',
    reason: (data.reason as string) ?? null,
    metadata: (data.metadata as Record<string, unknown>) ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
});
