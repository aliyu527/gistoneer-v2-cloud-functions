import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {AggregateField} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';

interface EngagementResponse {
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
}

/**
 * A real platform-wide total via Firestore's sum() aggregation query
 * (verified against current Firebase docs before use — this codebase had
 * never used sum()/count() aggregation before this module) — never a loop
 * downloading every matching post to add up counts.likes by hand.
 */
export const getEngagementSummary = onCall<DashboardRangeInput, Promise<EngagementResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const {start, end} = resolveRange(request.data ?? {});

  const query = db
    .collection('posts')
    .where('status', '==', 'published')
    .where('audience', '==', 'public')
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end);

  const snap = await query
    .aggregate({
      likes: AggregateField.sum('counts.likes'),
      comments: AggregateField.sum('counts.comments'),
      bookmarks: AggregateField.sum('counts.bookmarks'),
      shares: AggregateField.sum('counts.shares'),
    })
    .get();

  const data = snap.data();
  return {
    likes: data.likes ?? 0,
    comments: data.comments ?? 0,
    bookmarks: data.bookmarks ?? 0,
    shares: data.shares ?? 0,
  };
});
