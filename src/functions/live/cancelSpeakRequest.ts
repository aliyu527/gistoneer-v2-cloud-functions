import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {cancelSpeakRequest as cancelSpeakRequestService} from '../../live/service';

interface CancelSpeakRequestRequest {
  liveId: string;
}

export const cancelSpeakRequest = onCall<CancelSpeakRequestRequest, Promise<{requested: false}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }

    await cancelSpeakRequestService(request.auth.uid, liveId);
    return {requested: false};
  },
);
