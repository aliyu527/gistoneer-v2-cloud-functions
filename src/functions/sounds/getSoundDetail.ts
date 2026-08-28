import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getSoundDetail as getSoundDetailService} from '../../sounds/service';
import type {GistoneerSound} from '../../sounds/types';

interface GetSoundDetailRequest {
  providerTrackId: string;
}

/**
 * Used both by the client's track-detail view and, indirectly, to check
 * whether a previously-selected catalog sound (e.g. one restored from a
 * draft) is still available before letting the user keep it.
 */
export const getSoundDetail = onCall<GetSoundDetailRequest, Promise<GistoneerSound | null>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {providerTrackId} = request.data ?? {};
    if (typeof providerTrackId !== 'string' || providerTrackId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing track reference.');
    }

    try {
      return await getSoundDetailService(providerTrackId);
    } catch {
      throw new HttpsError('unavailable', "Couldn't load this sound. Check your connection and try again.");
    }
  },
);
