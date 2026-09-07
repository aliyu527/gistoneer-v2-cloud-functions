import {onCall} from 'firebase-functions/v2/https';
import {AggregateField} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {resolveRange, buildBuckets, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface EngagementTrendPoint {
  date: string;
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
}

interface EngagementTrendResponse {
  points: EngagementTrendPoint[];
}

/**
 * Same filter shape as getEngagementSummary.ts (status=='published',
 * audience=='public', createdAt range) — reuses that exact composite index,
 * just bucketed per buildBuckets instead of one whole-range sum().
 */
export const getEngagementTrend = onCall<DashboardRangeInput, Promise<EngagementTrendResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});
  const buckets = buildBuckets(start, end);

  const snaps = await Promise.all(
    buckets.map((bucket) =>
      db
        .collection('posts')
        .where('status', '==', 'published')
        .where('audience', '==', 'public')
        .where('createdAt', '>=', bucket.start)
        .where('createdAt', '<=', bucket.end)
        .aggregate({
          likes: AggregateField.sum('counts.likes'),
          comments: AggregateField.sum('counts.comments'),
          bookmarks: AggregateField.sum('counts.bookmarks'),
          shares: AggregateField.sum('counts.shares'),
        })
        .get(),
    ),
  );

  return {
    points: buckets.map((bucket, index) => {
      const data = snaps[index].data();
      return {
        date: bucket.label,
        likes: data.likes ?? 0,
        comments: data.comments ?? 0,
        bookmarks: data.bookmarks ?? 0,
        shares: data.shares ?? 0,
      };
    }),
  };
});
