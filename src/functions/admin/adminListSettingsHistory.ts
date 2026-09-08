import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminSettingsHistoryItem {
  id: string;
  actorEmail: string | null;
  reason: string | null;
  createdAt: string | null;
}

interface AdminListSettingsHistoryRequest {
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListSettingsHistoryResponse {
  entries: AdminSettingsHistoryItem[];
  nextCursor: string | null;
}

/** Reuses adminAuditLogs directly (Decision 6) — mirrors adminListModerationHistory.ts exactly, off the same existing (action, createdAt) composite index. Every settings.update entry's `reason` is already a human-readable "Field: before → after" string (written by updatePlatformSettings.ts), so there's no separate before/after field to project here. */
export const adminListSettingsHistory = onCall<AdminListSettingsHistoryRequest, Promise<AdminListSettingsHistoryResponse>>({cors: true, region: 'us-central1', minInstances: 1, maxInstances: 10}, async (request) => {
  await requireActiveAdmin(request, 'settings.read');

  const {sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q = db.collection('adminAuditLogs').where('action', '==', 'settings.update').orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('adminAuditLogs').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const entries: AdminSettingsHistoryItem[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      actorEmail: (data.actorEmail as string) ?? null,
      reason: (data.reason as string) ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  });
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {entries, nextCursor};
});
