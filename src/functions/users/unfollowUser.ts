import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unfollowUser as unfollowUserService} from '../../users/interactions';

interface UnfollowUserRequest {
  uid: string;
}

export const unfollowUser = onCall<UnfollowUserRequest, Promise<{following: false}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {uid} = request.data ?? {};
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing user reference.');
  }

  await unfollowUserService(request.auth.uid, uid);
  return {following: false};
});
