import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {denySpeaker as denySpeakerService} from '../../live/service';

interface DenySpeakerRequest {
  liveId: string;
  uid: string;
}

export const denySpeaker = onCall<DenySpeakerRequest, Promise<{denied: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {liveId, uid} = request.data ?? {};
  if (typeof liveId !== 'string' || liveId.length === 0 || typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing reference.');
  }

  await denySpeakerService(request.auth.uid, liveId, uid);
  return {denied: true};
});
