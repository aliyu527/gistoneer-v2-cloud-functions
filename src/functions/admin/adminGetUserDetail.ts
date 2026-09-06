import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import type {AdminUserListItem} from './adminListUsers';

export interface AdminUserDetail extends AdminUserListItem {
  usernameLower: string | null;
  primaryMethod: 'phone' | 'email' | null;
  authProviders: string[];
  onboardingCompleted: boolean;
  birthday: string | null;
  interests: string[];
  updatedAt: string | null;
  contentCounts: {posts: number; sounds: number; playlists: number};
  lastSuspension: {reason: string | null; at: string | null; byEmail: string | null} | null;
}

interface AdminGetUserDetailRequest {
  uid: string;
}

/**
 * Full admin-facing user record — includes email/phone, which the public
 * getUserProfile callable deliberately withholds. Every field here is a real
 * field confirmed present in the actual users/{uid} document (see Module 04
 * audit); no membership/activity/verification-beyond-email-phone fields are
 * invented since none exist in the data model.
 */
export const adminGetUserDetail = onCall<AdminGetUserDetailRequest, Promise<AdminUserDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }

  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This user could not be found.');
  }
  const data = snap.data()!;
  const status = (data.status as AdminUserListItem['status']) ?? 'active';

  const [postsSnap, soundsSnap, playlistsSnap, lastSuspensionSnap] = await Promise.all([
    db.collection('posts').where('authorId', '==', uid).count().get(),
    db.collection('sounds').where('ownerId', '==', uid).count().get(),
    db.collection('playlists').where('ownerId', '==', uid).count().get(),
    status === 'suspended'
      ? db.collection('adminAuditLogs').where('targetUid', '==', uid).where('action', '==', 'user.suspend').orderBy('createdAt', 'desc').limit(1).get()
      : Promise.resolve(null),
  ]);

  let lastSuspension: AdminUserDetail['lastSuspension'] = null;
  if (lastSuspensionSnap && !lastSuspensionSnap.empty) {
    const entry = lastSuspensionSnap.docs[0].data();
    lastSuspension = {
      reason: (entry.reason as string) ?? null,
      at: entry.createdAt?.toDate?.().toISOString() ?? null,
      byEmail: (entry.actorEmail as string) ?? null,
    };
  }

  return {
    uid: snap.id,
    username: (data.username as string) ?? null,
    displayName: (data.displayName as string) ?? null,
    photoURL: (data.photoURL as string) ?? null,
    email: (data.email as string) ?? null,
    phone: (data.phone as string) ?? null,
    status,
    emailVerified: Boolean(data.emailVerified),
    phoneVerified: Boolean(data.phoneVerified),
    followerCount: typeof data.followerCount === 'number' ? data.followerCount : 0,
    followingCount: typeof data.followingCount === 'number' ? data.followingCount : 0,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    usernameLower: (data.usernameLower as string) ?? null,
    primaryMethod: (data.primaryMethod as AdminUserDetail['primaryMethod']) ?? null,
    authProviders: Array.isArray(data.authProviders) ? (data.authProviders as string[]) : [],
    onboardingCompleted: Boolean(data.onboardingCompleted),
    birthday: (data.birthday as string) ?? null,
    interests: Array.isArray(data.interests) ? (data.interests as string[]) : [],
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    contentCounts: {
      posts: postsSnap.data().count,
      sounds: soundsSnap.data().count,
      playlists: playlistsSnap.data().count,
    },
    lastSuspension,
  };
});
