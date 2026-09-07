import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';

interface UserAnalyticsSummaryResponse {
  totalUsers: number;
  suspendedUsers: number;
  emailVerifiedUsers: number;
  phoneVerifiedUsers: number;
}

/**
 * The one breakdown getDashboardOverview/getUserGrowthSeries don't already
 * cover (total/new users, growth chart) — status and verification counts,
 * each a plain single-equality count() (automatically indexed, no
 * composite index needed). No DAU/WAU/MAU/retention here — there is no
 * login/activity timestamp on regular users/{uid} docs anywhere in this
 * app (only admins/{uid} tracks lastLoginAt, for the admin panel's own
 * session), so those metrics are omitted rather than fabricated.
 */
export const getUserAnalyticsSummary = onCall<undefined, Promise<UserAnalyticsSummaryResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const [totalSnap, suspendedSnap, emailVerifiedSnap, phoneVerifiedSnap] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('users').where('status', '==', 'suspended').count().get(),
    db.collection('users').where('emailVerified', '==', true).count().get(),
    db.collection('users').where('phoneVerified', '==', true).count().get(),
  ]);

  return {
    totalUsers: totalSnap.data().count,
    suspendedUsers: suspendedSnap.data().count,
    emailVerifiedUsers: emailVerifiedSnap.data().count,
    phoneVerifiedUsers: phoneVerifiedSnap.data().count,
  };
});
