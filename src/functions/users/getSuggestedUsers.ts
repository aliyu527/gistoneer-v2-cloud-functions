import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getSuggestedUsers as getSuggestedUsersService, type SuggestedUsersPage} from '../../users/interactions';
import {enforceRateLimit} from '../../lib/rateLimit';

interface GetSuggestedUsersRequest {
  cursor?: string;
  pageSize?: number;
}

/**
 * Discover's "People" tab default (browse) list — ranked by real
 * followerCount, no separate suggestion system. Same "users collection is
 * owner-only read, server-brokered" posture as searchUsers/getFollowers.
 */
export const getSuggestedUsers = onCall<GetSuggestedUsersRequest, Promise<SuggestedUsersPage>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    await enforceRateLimit(request.auth.uid, 'getSuggestedUsers', {maxPerWindow: 100, windowMs: 10 * 60 * 1000});
    const {cursor, pageSize} = request.data ?? {};
    return getSuggestedUsersService(request.auth.uid, cursor, pageSize);
  },
);
