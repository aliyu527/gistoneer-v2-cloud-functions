import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {isFollowing} from '../../users/interactions';

interface GetUserProfileRequest {
  uid: string;
}

export interface PublicUserProfile {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
}

/**
 * Public-safe user profile fetch — mirrors searchUsers.ts's PublicUser
 * shape exactly (never email/phone, those are private/self-only) plus the
 * follow graph. isFollowing is a single deterministic-id doc .get() on
 * follows/{callerUid}_{uid}, never a scan. Unthrottled, same posture as
 * likePost/bookmarkPost/getSoundDetail (not searchUsers, which rate-limits
 * specifically because it's a scan-style query).
 */
export const getUserProfile = onCall<GetUserProfileRequest, Promise<PublicUserProfile>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {uid} = request.data ?? {};
    if (typeof uid !== 'string' || uid.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing user reference.');
    }

    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', "We couldn't find that user.");
    }
    const data = snap.data()!;

    const following = request.auth.uid === uid ? false : await isFollowing(request.auth.uid, uid);

    return {
      uid,
      username: (data.username as string) ?? null,
      displayName: (data.displayName as string) ?? null,
      photoURL: (data.photoURL as string) ?? null,
      followerCount: (data.followerCount as number) ?? 0,
      followingCount: (data.followingCount as number) ?? 0,
      isFollowing: following,
    };
  },
);
