import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getFollowers as getFollowersService, type FollowersPage} from '../../users/interactions';

interface GetFollowersRequest {
  /** Whose followers to list — defaults to the caller (backward compatible with every existing caller that omits it). */
  uid?: string;
  cursor?: string;
  pageSize?: number;
}

export const getFollowers = onCall<GetFollowersRequest, Promise<FollowersPage>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {uid, cursor, pageSize} = request.data ?? {};
  return getFollowersService(uid ?? request.auth.uid, request.auth.uid, cursor, pageSize);
});
