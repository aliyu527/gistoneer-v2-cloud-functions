import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {enforceRateLimit} from '../../lib/rateLimit';
import {isValidReason, resolveTargetSnapshot, type ReportTargetType} from '../../reports/service';

const TARGET_TYPES: ReportTargetType[] = ['user', 'post', 'comment', 'sound', 'live', 'vendor', 'listing'];
const MAX_DESCRIPTION_LENGTH = 500;

interface SubmitReportRequest {
  targetType?: ReportTargetType;
  targetId?: string;
  context?: {postId?: string};
  reason?: string;
  description?: string;
}

interface SubmitReportResponse {
  reportId: string;
}

/**
 * The first real report-submission path this app has ever had (the mobile
 * ReportScreen previously had no working Submit handler at all). Goes
 * through this callable rather than a direct client write to `reports` —
 * matches this codebase's universal "writes go through a callable, rules
 * are write:false" convention — so the target snapshot and rate limiting
 * are always server-enforced, never trusted from the client.
 */
export const submitReport = onCall<SubmitReportRequest, Promise<SubmitReportResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;
  const data = request.data ?? ({} as SubmitReportRequest);

  if (!data.targetType || !TARGET_TYPES.includes(data.targetType)) {
    throw new HttpsError('invalid-argument', 'Invalid report target.');
  }
  const targetId = data.targetId;
  if (typeof targetId !== 'string' || targetId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing target.');
  }
  if (!isValidReason(data.reason)) {
    throw new HttpsError('invalid-argument', 'Invalid reason.');
  }
  const description = typeof data.description === 'string' ? data.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) : '';
  if (data.reason === 'Other' && description.length === 0) {
    throw new HttpsError('invalid-argument', 'Please describe the issue.');
  }
  if (data.targetType === 'comment' && !data.context?.postId) {
    throw new HttpsError('invalid-argument', 'Missing comment context.');
  }

  await enforceRateLimit(uid, 'submitReport', {maxPerWindow: 10, windowMs: 10 * 60 * 1000});

  const snapshot = await resolveTargetSnapshot(data.targetType, targetId, data.context);
  if (!snapshot) {
    throw new HttpsError('not-found', 'This could not be found.');
  }
  if (snapshot.ownerId === uid) {
    throw new HttpsError('invalid-argument', "You can't report your own content.");
  }

  const ref = await db.collection('reports').add({
    reporterId: uid,
    targetType: data.targetType,
    targetId,
    ...(data.context?.postId ? {context: {postId: data.context.postId}} : {}),
    reason: data.reason,
    ...(description ? {description} : {}),
    status: 'pending',
    targetSnapshot: snapshot,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {reportId: ref.id};
});
