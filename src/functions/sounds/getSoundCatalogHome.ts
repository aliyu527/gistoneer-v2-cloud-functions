import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getCatalogHome} from '../../sounds/service';
import type {GistoneerSound, SoundCategory} from '../../sounds/types';

interface CatalogHomeResponse {
  featured: GistoneerSound[];
  trending: GistoneerSound[];
  popular: GistoneerSound[];
  genres: SoundCategory[];
}

/** One combined call for the Sound Library's home screen — avoids 4 separate round trips. */
export const getSoundCatalogHome = onCall<unknown, Promise<CatalogHomeResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    try {
      return await getCatalogHome();
    } catch {
      throw new HttpsError('unavailable', "Couldn't load sounds. Check your connection and try again.");
    }
  },
);
