import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, buildBuckets, type DashboardRangeInput} from './dashboardRange';

export interface UserGrowthPoint {
  date: string;
  newUsers: number;
}

interface UserGrowthResponse {
  points: UserGrowthPoint[];
}

/**
 * One count() aggregation per bucket (bounded to ~31 by buildBuckets'
 * adaptive granularity) rather than downloading every user doc to bucket
 * client-side — the codebase's established "no full-collection reads" rule
 * applies just as much to a chart as to a single number.
 */
export const getUserGrowthSeries = onCall<DashboardRangeInput, Promise<UserGrowthResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const {start, end} = resolveRange(request.data ?? {});
  const buckets = buildBuckets(start, end);

  const counts = await Promise.all(
    buckets.map((bucket) => db.collection('users').where('createdAt', '>=', bucket.start).where('createdAt', '<=', bucket.end).count().get()),
  );

  return {
    points: buckets.map((bucket, index) => ({date: bucket.label, newUsers: counts[index].data().count})),
  };
});
