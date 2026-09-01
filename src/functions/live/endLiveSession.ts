import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {endLiveSession as endLiveSessionService} from '../../live/service';

interface EndLiveSessionRequest {
  liveId: string;
}

export const endLiveSession = onCall<EndLiveSessionRequest, Promise<{status: 'ended'}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    await endLiveSessionService(request.auth.uid, liveId);
    return {status: 'ended'};
  },
);
