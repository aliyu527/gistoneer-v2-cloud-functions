import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {followUser as followUserService} from '../../users/interactions';

interface FollowUserRequest {
  uid: string;
}

export const followUser = onCall<FollowUserRequest, Promise<{following: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {uid} = request.data ?? {};
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing user reference.');
  }

  await followUserService(request.auth.uid, uid);
  return {following: true};
});
