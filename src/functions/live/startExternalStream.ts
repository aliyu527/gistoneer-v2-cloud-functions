import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {startExternalStream as startExternalStreamService} from '../../live/service';
import {AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET} from '../../config';

interface StartExternalStreamRequest {
  liveId: string;
}

export const startExternalStream = onCall<StartExternalStreamRequest, Promise<{rtmpServerUrl: string; streamKey: string}>>(
  {cors: true, region: 'us-central1', secrets: [AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    return startExternalStreamService(request.auth.uid, liveId);
  },
);
