import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {goLive as goLiveService} from '../../live/service';

interface GoLiveRequest {
  liveId: string;
}

export const goLive = onCall<GoLiveRequest, Promise<{status: 'live'}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {liveId} = request.data ?? {};
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing live session reference.');
  }

  await goLiveService(request.auth.uid, liveId);
  return {status: 'live'};
});
