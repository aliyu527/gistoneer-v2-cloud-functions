import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getFollowing as getFollowingService, type FollowersPage} from '../../users/interactions';

interface GetFollowingRequest {
  /** Whose following-list to fetch — defaults to the caller. */
  uid?: string;
  cursor?: string;
  pageSize?: number;
}

export const getFollowing = onCall<GetFollowingRequest, Promise<FollowersPage>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {uid, cursor, pageSize} = request.data ?? {};
  return getFollowingService(uid ?? request.auth.uid, request.auth.uid, cursor, pageSize);
});
