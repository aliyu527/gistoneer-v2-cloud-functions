import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {endLiveSession as endLiveSessionService} from '../../live/service';
import {AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET} from '../../config';

interface EndLiveSessionRequest {
  liveId: string;
}

// endLiveSession() now also stops any in-flight Cloud Recording (see
// stopRecordingIfActive in live/service.ts) — that path's Cloud Recording
// REST auth secrets must be declared here too, same reasoning as goLive.ts.
export const endLiveSession = onCall<EndLiveSessionRequest, Promise<{status: 'ended'}>>(
  {cors: true, region: 'us-central1', secrets: [AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET]},
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
