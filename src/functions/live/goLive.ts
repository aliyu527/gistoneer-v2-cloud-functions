import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {goLive as goLiveService} from '../../live/service';
import {AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY} from '../../config';

interface GoLiveRequest {
  liveId: string;
}

// goLive() now also best-effort starts a Cloud Recording (see live/recording.ts)
// — every secret that path touches (recording token + Cloud Recording REST
// auth + S3 storageConfig credentials) must be declared here, or Cloud
// Functions v2 simply won't mount them for this specific function's
// container, regardless of what the imported code tries to read.
export const goLive = onCall<GoLiveRequest, Promise<{status: 'live'}>>(
  {cors: true, region: 'us-central1', secrets: [AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    await goLiveService(request.auth.uid, liveId);
    return {status: 'live'};
  },
);
