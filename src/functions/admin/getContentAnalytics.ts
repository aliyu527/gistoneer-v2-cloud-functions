import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, buildBuckets, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface ContentCreationPoint {
  date: string;
  posts: number;
}

interface ContentAnalyticsResponse {
  points: ContentCreationPoint[];
  activeCount: number;
  hiddenCount: number;
  removedCount: number;
}

/**
 * Content-created trend mirrors getUserGrowthSeries.ts's exact bucketed
 * count() pattern (same `posts(status, createdAt)` composite index
 * getDashboardOverview's own newPosts count already relies on — no new
 * index needed).
 *
 * activeCount is derived (total − hidden − removed), NOT queried via
 * `moderationStatus=='active'` — that field is only ever explicitly written
 * by hideContent/removeContent (see those files' own comments on the
 * Module 05 outage this caused for firestore.rules); a post that's never
 * been moderated has no moderationStatus field at all, and Firestore's
 * equality filter never matches a missing field, so a direct query would
 * silently undercount every never-moderated post as not-active.
 */
export const getContentAnalytics = onCall<DashboardRangeInput, Promise<ContentAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});
  const buckets = buildBuckets(start, end);

  const [bucketCounts, totalSnap, hiddenSnap, removedSnap] = await Promise.all([
    Promise.all(
      buckets.map((bucket) =>
        db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', bucket.start).where('createdAt', '<=', bucket.end).count().get(),
      ),
    ),
    db.collection('posts').where('status', '==', 'published').count().get(),
    db.collection('posts').where('status', '==', 'published').where('moderationStatus', '==', 'hidden').count().get(),
    db.collection('posts').where('status', '==', 'published').where('moderationStatus', '==', 'removed').count().get(),
  ]);

  const hiddenCount = hiddenSnap.data().count;
  const removedCount = removedSnap.data().count;

  return {
    points: buckets.map((bucket, index) => ({date: bucket.label, posts: bucketCounts[index].data().count})),
    activeCount: Math.max(0, totalSnap.data().count - hiddenCount - removedCount),
    hiddenCount,
    removedCount,
  };
});
