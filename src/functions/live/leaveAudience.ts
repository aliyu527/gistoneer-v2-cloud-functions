import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {leaveAudience as leaveAudienceService} from '../../live/service';

interface LeaveAudienceRequest {
  liveId: string;
}

export const leaveAudience = onCall<LeaveAudienceRequest, Promise<{left: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    await leaveAudienceService(request.auth.uid, liveId);
    return {left: true};
  },
);
