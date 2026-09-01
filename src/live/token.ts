import {HttpsError} from 'firebase-functions/v2/https';
import {RtcTokenBuilder, RtcRole} from 'agora-token';
import {db} from '../admin';
import {AGORA_APP_ID, AGORA_APP_CERTIFICATE} from '../config';
import {joinAudience} from './service';

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour — see host-live.tsx's TODO for mid-broadcast refresh

export type LiveRole = 'host' | 'audience';

export interface LiveTokenResult {
  token: string;
  appId: string;
  channelName: string;
  agoraUid: number;
}

/**
 * A Firebase uid is a string; Agora's numeric uid must be a positive
 * 32-bit integer. Derived deterministically (not client-supplied) so the
 * same person always maps to the same in-channel uid and nobody can spoof
 * another user's Agora identity by choosing their own number. FNV-1a is
 * plenty for this — collision risk is not a security boundary here (worst
 * case two users render as the same remote tile), it's just a stable,
 * cheap, dependency-free hash.
 */
function agoraUidFor(firebaseUid: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < firebaseUid.length; i++) {
    hash ^= firebaseUid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Keep it in 1..(2^31-1) — comfortably inside Agora's 1..(2^32-1) uid
  // range, and avoids the sign bit entirely (Agora's own JS type is a
  // plain `number`, so staying under 2^31 sidesteps any signed/unsigned
  // ambiguity in how the native SDK marshals it).
  return (hash >>> 0) % 0x7fffffff || 1;
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

  if (role === 'host') {
    if (session.hostId !== uid) {
      throw new HttpsError('permission-denied', "This isn't your live session.");
    }
  } else if (session.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This live is no longer available.');
  }

  const channelName = session.agoraChannelName as string;
  const agoraUid = agoraUidFor(uid);
  const rtcRole = role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

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
