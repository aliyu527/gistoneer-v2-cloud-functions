import {HttpsError} from 'firebase-functions/v2/https';
import {RtcTokenBuilder, RtcRole} from 'agora-token';
import {db} from '../admin';
import {AGORA_APP_ID, AGORA_APP_CERTIFICATE} from '../config';
import {joinAudience} from './service';
import {agoraUidFor} from './agoraUid';

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour — see host-live.tsx's TODO for mid-broadcast refresh

export type LiveRole = 'host' | 'audience' | 'speaker';

export interface LiveTokenResult {
  token: string;
  appId: string;
  channelName: string;
  agoraUid: number;
}

/**
 * IMPORTANT — Agora's own RtcTokenBuilder docs (agora-token package) state
 * that RtcRole.SUBSCRIBER only actually blocks publishing if "Co-host Token
 * Authentication" is enabled for this App ID in the Agora Console; absent
 * that project-level setting, a SUBSCRIBER token carries the same publish
 * privileges as PUBLISHER. This function still requests the correct role
 * (and the client still calls setClientRole(Audience) + never calls
 * startPreview()/publishes locally as a defense-in-depth layer), but the
 * actual hard guarantee that a viewer's token cannot publish requires
 * enabling that setting in the Agora Console — a one-time account
 * configuration step outside this codebase, not something achievable in
 * code alone. Flagged here so it isn't mistaken for already being enforced.
 */
export async function getLiveToken(uid: string, liveId: string, role: LiveRole): Promise<LiveTokenResult> {
  const snap = await db.collection('liveSessions').doc(liveId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', "We couldn't find that live session.");
  }
  const session = snap.data()!;

  let agoraUid = agoraUidFor(uid);

  if (role === 'host') {
    if (session.hostId !== uid) {
      throw new HttpsError('permission-denied', "This isn't your live session.");
    }
  } else if (session.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This live is no longer available.');
  }

  if (role === 'speaker') {
    // Reuse the agoraUid already stored on the presence doc (the same
    // value every other client already knows via the parent's denormalized
    // activeSpeakers) rather than re-deriving — a belt-and-suspenders
    // consistency guarantee, even though agoraUidFor is itself deterministic.
    const presenceSnap = await db.collection('liveSessions').doc(liveId).collection('audience').doc(uid).get();
    if (!presenceSnap.exists || presenceSnap.data()!.speakStatus !== 'approved') {
      throw new HttpsError('permission-denied', "You haven't been approved to speak.");
    }
    agoraUid = (presenceSnap.data()!.agoraUid as number) ?? agoraUid;
  }

  const channelName = session.agoraChannelName as string;
  const rtcRole = role === 'audience' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

  // agora-token@2.0.6's buildTokenWithUid takes tokenExpire/privilegeExpire
  // as durations in seconds *from now* (confirmed against the installed
  // package's own type declarations), not absolute Unix timestamps —
  // easy to get backwards against older Agora docs/examples that pass an
  // absolute `privilegeExpiredTs`.
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID.value(),
    AGORA_APP_CERTIFICATE.value(),
    channelName,
    agoraUid,
    rtcRole,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
  );

  // "Get a token" and "count as a viewer" are one atomic client action —
  // avoids a "got token but forgot to report viewership" gap between two
  // separate calls.
  if (role === 'audience') {
    await joinAudience(uid, liveId);
  }

  return {token, appId: AGORA_APP_ID.value(), channelName, agoraUid};
}
