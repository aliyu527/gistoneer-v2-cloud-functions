import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {sendLiveMessage as sendLiveMessageService, type LiveChatMessage} from '../../live/chat';

interface SendLiveMessageRequest {
  liveId: string;
  text: string;
}

export const sendLiveMessage = onCall<SendLiveMessageRequest, Promise<LiveChatMessage>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {liveId, text} = request.data ?? {};
    if (typeof liveId !== 'string' || liveId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing live session reference.');
    }
    if (typeof text !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing message text.');
    }

    return sendLiveMessageService(request.auth.uid, liveId, text);
  },
);
