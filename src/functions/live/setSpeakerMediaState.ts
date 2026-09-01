import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {setSpeakerMediaState as setSpeakerMediaStateService} from '../../live/service';

interface SetSpeakerMediaStateRequest {
  liveId: string;
  uid: string;
  audioMuted?: boolean;
  videoMuted?: boolean;
}

export const setSpeakerMediaState = onCall<SetSpeakerMediaStateRequest, Promise<{updated: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId, uid, audioMuted, videoMuted} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0 || typeof uid !== 'string' || uid.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing reference.');
    }
    if (audioMuted === undefined && videoMuted === undefined) {
      throw new HttpsError('invalid-argument', 'Nothing to update.');
    }

    await setSpeakerMediaStateService(request.auth.uid, liveId, uid, {
      ...(typeof audioMuted === 'boolean' ? {audioMuted} : {}),
      ...(typeof videoMuted === 'boolean' ? {videoMuted} : {}),
    });
    return {updated: true};
  },
);
