import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {requestToSpeak as requestToSpeakService} from '../../live/service';

interface RequestToSpeakRequest {
  liveId: string;
}

export const requestToSpeak = onCall<RequestToSpeakRequest, Promise<{requested: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    await requestToSpeakService(request.auth.uid, liveId);
    return {requested: true};
  },
);
