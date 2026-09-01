import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {approveSpeaker as approveSpeakerService} from '../../live/service';

interface ApproveSpeakerRequest {
  liveId: string;
  uid: string;
}

export const approveSpeaker = onCall<ApproveSpeakerRequest, Promise<{approved: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId, uid} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0 || typeof uid !== 'string' || uid.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing reference.');
    }

    await approveSpeakerService(request.auth.uid, liveId, uid);
    return {approved: true};
  },
);
