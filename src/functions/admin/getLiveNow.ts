import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';

const MAX_LIVE_SESSIONS = 5;

export interface LiveNowSession {
  id: string;
  hostName: string;
  hostAvatarUrl: string | null;
  title: string;
  viewerCount: number;
  startedAt: string | null;
}

interface LiveNowResponse {
  sessions: LiveNowSession[];
  totalLive: number;
}

/**
 * All visibility (public AND private) — an admin with live.read is allowed
 * to see private broadcasts too (spec's own explicit live-privacy carve-out),
 * unlike the mobile app's own public-only live feed query.
 */
export const getLiveNow = onCall<undefined, Promise<LiveNowResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const [listSnap, countSnap] = await Promise.all([
    db.collection('liveSessions').where('status', '==', 'live').orderBy('viewerCount', 'desc').limit(MAX_LIVE_SESSIONS).get(),
    db.collection('liveSessions').where('status', '==', 'live').count().get(),
  ]);

  const sessions: LiveNowSession[] = listSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      hostName: (data.hostName as string) ?? 'Gistoneer user',
      hostAvatarUrl: (data.hostAvatarUrl as string) ?? null,
      title: (data.title as string) ?? '',
      viewerCount: (data.viewerCount as number) ?? 0,
      startedAt: data.startedAt?.toDate?.().toISOString() ?? null,
    };
  });

  return {sessions, totalLive: countSnap.data().count};
});
