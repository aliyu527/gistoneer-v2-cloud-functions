import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getFavoriteTemplates as getFavoriteTemplatesService} from '../../templates/service';
import type {GistoneerTemplate} from '../../templates/types';

export const getFavoriteTemplates = onCall<unknown, Promise<GistoneerTemplate[]>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    try {
      return await getFavoriteTemplatesService(request.auth.uid);
    } catch {
      throw new HttpsError('unavailable', "Couldn't load your saved templates. Check your connection and try again.");
    }
  },
);
