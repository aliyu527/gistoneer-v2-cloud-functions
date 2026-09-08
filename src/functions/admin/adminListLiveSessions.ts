import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export type LiveSessionStatus = 'starting' | 'live' | 'ended';
export type LiveRecordingStatus = 'recording' | 'stopping' | 'uploading' | 'ready' | 'failed';

export interface AdminLiveSessionListItem {
  id: string;
  hostId: string;
  hostName: string;
  hostAvatarUrl: string | null;
  title: string;
  visibility: 'public' | 'private';
  sourceType: 'camera' | 'external';
  status: LiveSessionStatus;
  viewerCount: number;
  recordingStatus: LiveRecordingStatus | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
}

interface AdminListLiveSessionsRequest {
  status?: LiveSessionStatus;
  recordingStatus?: LiveRecordingStatus;
  hostId?: string;
  sortBy?: 'createdAt' | 'viewerCount';
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListLiveSessionsResponse {
  sessions: AdminLiveSessionListItem[];
  nextCursor: string | null;
}

export function toLiveSessionListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminLiveSessionListItem {
  const data = doc.data();
  return {
    id: doc.id,
    hostId: (data.hostId as string) ?? '',
    hostName: (data.hostName as string) ?? 'Gistoneer user',
    hostAvatarUrl: (data.hostAvatarUrl as string) ?? null,
    title: (data.title as string) ?? '',
    visibility: (data.visibility as AdminLiveSessionListItem['visibility']) ?? 'public',
    sourceType: (data.sourceType as AdminLiveSessionListItem['sourceType']) ?? 'camera',
    status: (data.status as LiveSessionStatus) ?? 'ended',
    viewerCount: typeof data.viewerCount === 'number' ? data.viewerCount : 0,
    recordingStatus: (data.recordingStatus as LiveRecordingStatus) ?? null,
    startedAt: data.startedAt?.toDate?.().toISOString() ?? null,
    endedAt: data.endedAt?.toDate?.().toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Paginated, filterable admin live-session list (live + history combined —
 * `status` is just one of the optional filters, not a separate route).
 * `hostName`/`hostAvatarUrl` are already denormalized onto every session
 * doc, so this needs zero N+1 host lookups. `sortBy: 'viewerCount'` is only
 * honored when `status` is also set, matching the existing
 * `(status, viewerCount desc)` index used by getLiveNow.ts.
 */
export const adminListLiveSessions = onCall<AdminListLiveSessionsRequest, Promise<AdminListLiveSessionsResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'live.read');

  const {status, recordingStatus, hostId, sortBy = 'createdAt', sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('liveSessions');
  if (status) {
    q = q.where('status', '==', status);
  } else if (recordingStatus) {
    q = q.where('recordingStatus', '==', recordingStatus);
  } else if (hostId) {
    q = q.where('hostId', '==', hostId);
  }

  const effectiveSortBy = status && sortBy === 'viewerCount' ? 'viewerCount' : hostId ? 'updatedAt' : 'createdAt';
  q = q.orderBy(effectiveSortBy, sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('liveSessions').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get(effectiveSortBy), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const sessions = snap.docs.map(toLiveSessionListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {sessions, nextCursor};
});
