import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {normalizeUsername} from '../lib/normalize';
import {reserveUsernameForUid} from '../users/service';
import type {ReserveUsernameRequest} from '../lib/types';

/**
 * Atomically reserves a username for the calling user. Runs as a Firestore
 * transaction (reserveUsernameForUid, functions/src/users/service.ts) so
 * "check then write" can never race two signups onto the same handle — the
 * same shared transaction the admin Create User function also calls.
 */
export const reserveUsername = onCall<ReserveUsernameRequest, Promise<{usernameLower: string}>>(
  {cors: true},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const usernameLower = normalizeUsername(request.data?.username ?? '');

    if (!usernameLower) {
      throw new HttpsError(
        'invalid-argument',
        'Usernames must be 3-20 characters and can only contain lowercase letters, numbers, and underscores.',
      );
    }

    await reserveUsernameForUid(uid, usernameLower);

    return {usernameLower};
  },
);
