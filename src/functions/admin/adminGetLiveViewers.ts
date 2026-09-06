import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminLiveViewer {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  joinedAt: string | null;
  speakStatus: 'none' | 'requested' | 'approved';
  audioMuted: boolean | null;
  videoMuted: boolean | null;
}

interface AdminGetLiveViewersRequest {
  liveId: string;
  pageSize?: number;
  cursor?: string;
}

interface AdminGetLiveViewersResponse {
  viewers: AdminLiveViewer[];
  nextCursor: string | null;
}

/**
 * A real, paginated "who's watching" list — the audience subcollection is
 * fully queryable via the Admin SDK even though it's unreadable by an
 * admin's own client SDK (rules only allow self/host reads). Ordered by
 * joinedAt (single-field, auto-indexed). This is a genuine new capability:
 * the parent doc's `viewers` array is capped at 100 and not paginable.
 */
export const adminGetLiveViewers = onCall<AdminGetLiveViewersRequest, Promise<AdminGetLiveViewersResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'live.read');

  const liveId = request.data?.liveId;
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing liveId.');
  }
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);
  const cursor = request.data?.cursor;

  let q = db.collection('liveSessions').doc(liveId).collection('audience').orderBy('joinedAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('liveSessions').doc(liveId).collection('audience').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('joinedAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const viewers: AdminLiveViewer[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: (data.uid as string) ?? doc.id,
      displayName: (data.displayName as string) ?? null,
      photoURL: (data.photoURL as string) ?? null,
      joinedAt: data.joinedAt?.toDate?.().toISOString() ?? null,
      speakStatus: (data.speakStatus as AdminLiveViewer['speakStatus']) ?? 'none',
      audioMuted: typeof data.audioMuted === 'boolean' ? data.audioMuted : null,
      videoMuted: typeof data.videoMuted === 'boolean' ? data.videoMuted : null,
    };
  });
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {viewers, nextCursor};
});
