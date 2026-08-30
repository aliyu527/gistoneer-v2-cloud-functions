import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getSavedSounds as getSavedSoundsService} from '../../sounds/service';
import type {GistoneerSound} from '../../sounds/types';

export const getSavedSounds = onCall<undefined, Promise<GistoneerSound[]>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }

  try {
    return await getSavedSoundsService(request.auth.uid);
  } catch {
    throw new HttpsError('unavailable', "Couldn't load your saved sounds. Check your connection and try again.");
  }
});
