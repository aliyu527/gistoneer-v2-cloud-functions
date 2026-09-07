import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

const MAX_DURATION_SAMPLE = 500;

interface LiveAnalyticsResponse {
  broadcastsStarted: number;
  broadcastsEnded: number;
  averageDurationMinutes: number | null;
}

/**
 * `broadcastsStarted`/`broadcastsEnded` are single-field range queries on
 * startedAt/endedAt (no composite index needed) — a session with startedAt
 * in range genuinely went live, which is the meaningful "broadcast"
 * signal, not merely "created". Average duration can't be computed via
 * sum()/average() aggregation (it's endedAt − startedAt, a value derived
 * across two fields, not a single stored field) — instead this does one
 * bounded read (capped at 500, generous for any real date range given live
 * session volume) and averages in the function, the same bounded-read
 * class as getTopContent.ts's own query. No peak-concurrent-viewer metric
 * here — only the current viewerCount is ever stored, not a historical
 * peak snapshot, so that's a disclosed gap, not fabricated.
 */
export const getLiveAnalytics = onCall<DashboardRangeInput, Promise<LiveAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});

  const [startedSnap, endedSnap, durationSampleSnap] = await Promise.all([
    db.collection('liveSessions').where('startedAt', '>=', start).where('startedAt', '<=', end).count().get(),
    db.collection('liveSessions').where('endedAt', '>=', start).where('endedAt', '<=', end).count().get(),
    db.collection('liveSessions').where('endedAt', '>=', start).where('endedAt', '<=', end).limit(MAX_DURATION_SAMPLE).get(),
  ]);

  let totalDurationMs = 0;
  let sampleCount = 0;
  for (const doc of durationSampleSnap.docs) {
    const data = doc.data();
    const startedAt = data.startedAt?.toDate?.();
    const endedAt = data.endedAt?.toDate?.();
    if (startedAt && endedAt && endedAt.getTime() > startedAt.getTime()) {
      totalDurationMs += endedAt.getTime() - startedAt.getTime();
      sampleCount += 1;
    }
  }

  return {
    broadcastsStarted: startedSnap.data().count,
    broadcastsEnded: endedSnap.data().count,
    averageDurationMinutes: sampleCount > 0 ? Math.round(totalDurationMs / sampleCount / 60000) : null,
  };
});
