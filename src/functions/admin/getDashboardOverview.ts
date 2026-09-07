import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdminAny} from './requireActiveAdmin';

interface OverviewResponse {
  totalUsers: number;
  newUsers: number;
  previousPeriodNewUsers: number;
  totalPosts: number;
  newPosts: number;
  previousPeriodNewPosts: number;
  liveNowCount: number;
  totalSounds: number;
  totalPlaylists: number;
}

/**
 * Every number here comes from a Firestore count() aggregation query — the
 * server computes and returns just the number, never a full collection
 * download (confirmed against current Firebase docs before using this;
 * nothing in this codebase used aggregation queries before this module).
 */
export const getDashboardOverview = onCall<DashboardRangeInput, Promise<OverviewResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdminAny(request);

  const {start, end, previousStart, previousEnd} = resolveRange(request.data ?? {});

  const [
    totalUsersSnap,
    newUsersSnap,
    previousNewUsersSnap,
    totalPostsSnap,
    newPostsSnap,
    previousNewPostsSnap,
    liveNowSnap,
    totalSoundsSnap,
    totalPlaylistsSnap,
  ] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('users').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
    db.collection('users').where('createdAt', '>=', previousStart).where('createdAt', '<=', previousEnd).count().get(),
    db.collection('posts').where('status', '==', 'published').count().get(),
    db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
    db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', previousStart).where('createdAt', '<=', previousEnd).count().get(),
    db.collection('liveSessions').where('status', '==', 'live').count().get(),
    db.collection('sounds').count().get(),
    db.collection('playlists').count().get(),
  ]);

  return {
    totalUsers: totalUsersSnap.data().count,
    newUsers: newUsersSnap.data().count,
    previousPeriodNewUsers: previousNewUsersSnap.data().count,
    totalPosts: totalPostsSnap.data().count,
    newPosts: newPostsSnap.data().count,
    previousPeriodNewPosts: previousNewPostsSnap.data().count,
    liveNowCount: liveNowSnap.data().count,
    totalSounds: totalSoundsSnap.data().count,
    totalPlaylists: totalPlaylistsSnap.data().count,
  };
});
