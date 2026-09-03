import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getFollowers as getFollowersService, type FollowersPage} from '../../users/interactions';

interface GetFollowersRequest {
  cursor?: string;
  pageSize?: number;
}

export const getFollowers = onCall<GetFollowersRequest, Promise<FollowersPage>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {cursor, pageSize} = request.data ?? {};
  return getFollowersService(request.auth.uid, cursor, pageSize);
});
