import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {ReportTargetType} from '../../reports/service';

const TARGET_TYPES: ReportTargetType[] = ['user', 'post', 'comment', 'sound', 'live', 'vendor', 'listing'];
const MAX_RESOLUTION_SAMPLE = 500;

interface ModerationAnalyticsResponse {
  submitted: number;
  resolved: number;
  dismissed: number;
  averageResolutionMinutes: number | null;
  byTargetType: Record<ReportTargetType, number>;
}

/**
 * `submitted` is a single-field range on createdAt (no index needed).
 * `resolved`/`dismissed` filter on resolvedAt range alone — a pending
 * report has no resolvedAt field at all, so this naturally excludes it
 * without needing an extra status equality (which would otherwise force a
 * new (status, resolvedAt) composite index). byTargetType is 7 plain
 * equality+range count()s reusing the exact `reports(targetType,
 * createdAt)` index already deployed for Module 10's list-by-type filter.
 * Average resolution time is a bounded read + in-function average, same
 * class as getLiveAnalytics.ts's duration calculation — resolvedAt−createdAt
 * can't be expressed as a single aggregate() field.
 */
export const getModerationAnalytics = onCall<DashboardRangeInput, Promise<ModerationAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});

  const [submittedSnap, resolvedSampleSnap, byTypeSnaps] = await Promise.all([
    db.collection('reports').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
    db.collection('reports').where('resolvedAt', '>=', start).where('resolvedAt', '<=', end).limit(MAX_RESOLUTION_SAMPLE).get(),
    Promise.all(
      TARGET_TYPES.map((type) =>
        db.collection('reports').where('targetType', '==', type).where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
      ),
    ),
  ]);

  let resolvedCount = 0;
  let dismissedCount = 0;
  let totalResolutionMs = 0;
  let resolutionSampleCount = 0;
  for (const doc of resolvedSampleSnap.docs) {
    const data = doc.data();
    if (data.status === 'resolved') resolvedCount += 1;
    else if (data.status === 'dismissed') dismissedCount += 1;

    const createdAt = data.createdAt?.toDate?.();
    const resolvedAt = data.resolvedAt?.toDate?.();
    if (createdAt && resolvedAt && resolvedAt.getTime() > createdAt.getTime()) {
      totalResolutionMs += resolvedAt.getTime() - createdAt.getTime();
      resolutionSampleCount += 1;
    }
  }

  const byTargetType = TARGET_TYPES.reduce(
    (acc, type, index) => {
      acc[type] = byTypeSnaps[index].data().count;
      return acc;
    },
    {} as Record<ReportTargetType, number>,
  );

  return {
    submitted: submittedSnap.data().count,
    resolved: resolvedCount,
    dismissed: dismissedCount,
    averageResolutionMinutes: resolutionSampleCount > 0 ? Math.round(totalResolutionMs / resolutionSampleCount / 60000) : null,
    byTargetType,
  };
});
