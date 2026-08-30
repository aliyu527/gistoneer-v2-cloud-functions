import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {saveSound as saveSoundService} from '../../sounds/service';

interface SaveSoundRequest {
  trackId: string;
}

export const saveSound = onCall<SaveSoundRequest, Promise<{saved: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {trackId} = request.data ?? {};
  if (typeof trackId !== 'string' || trackId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing track reference.');
  }

  await saveSoundService(request.auth.uid, trackId);
  return {saved: true};
});
