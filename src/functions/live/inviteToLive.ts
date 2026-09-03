import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {inviteToLive as inviteToLiveService} from '../../live/service';

interface InviteToLiveRequest {
  liveId: string;
  uids: string[];
}

export const inviteToLive = onCall<InviteToLiveRequest, Promise<{invited: true}>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const {liveId, uids} = request.data ?? {};
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing live session reference.');
  }
  if (!Array.isArray(uids) || uids.some((u) => typeof u !== 'string' || u.length === 0)) {
    throw new HttpsError('invalid-argument', 'Invalid invitee list.');
  }

  await inviteToLiveService(request.auth.uid, liveId, uids);
  return {invited: true};
});
