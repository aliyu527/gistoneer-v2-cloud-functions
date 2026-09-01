import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getLiveToken as getLiveTokenService, type LiveRole, type LiveTokenResult} from '../../live/token';
import {AGORA_APP_CERTIFICATE} from '../../config';

const ROLES = ['host', 'audience'] as const;

interface GetLiveTokenRequest {
  liveId: string;
  role: LiveRole;
}

export const getLiveToken = onCall<GetLiveTokenRequest, Promise<LiveTokenResult>>(
  {cors: true, region: 'us-central1', secrets: [AGORA_APP_CERTIFICATE]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId, role} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }
    if (!ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid role.');
    }

    return getLiveTokenService(request.auth.uid, liveId, role);
  },
);
