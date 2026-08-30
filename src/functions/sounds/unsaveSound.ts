import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unsaveSound as unsaveSoundService} from '../../sounds/service';

interface UnsaveSoundRequest {
  trackId: string;
}

export const unsaveSound = onCall<UnsaveSoundRequest, Promise<{saved: false}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {trackId} = request.data ?? {};
  if (typeof trackId !== 'string' || trackId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing track reference.');
  }

  await unsaveSoundService(request.auth.uid, trackId);
  return {saved: false};
});
