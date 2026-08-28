import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getSoundsByGenre as getSoundsByGenreService} from '../../sounds/service';
import type {GistoneerSound, Page} from '../../sounds/types';

interface GetSoundsByGenreRequest {
  categoryId: string;
  cursor?: string;
  limit?: number;
}

export const getSoundsByGenre = onCall<GetSoundsByGenreRequest, Promise<Page<GistoneerSound>>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {categoryId, cursor, limit} = request.data ?? {};
    if (typeof categoryId !== 'string' || categoryId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing genre.');
    }

    try {
      return await getSoundsByGenreService(categoryId, {cursor, limit});
    } catch {
      throw new HttpsError('unavailable', "Couldn't load sounds. Check your connection and try again.");
    }
  },
);
