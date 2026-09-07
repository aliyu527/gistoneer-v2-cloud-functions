import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toReportListItem, type AdminReportListItem} from './adminListReports';

const SEARCH_LIMIT = 20;

interface AdminSearchReportsRequest {
  query: string;
}

interface AdminSearchReportsResponse {
  reports: AdminReportListItem[];
}

/** Exact report id, or exact target id (every other report filed against the same entity) — same exact-match convention as every other search function in this admin panel. No free-text search over reason/description. */
export const adminSearchReports = onCall<AdminSearchReportsRequest, Promise<AdminSearchReportsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'reports.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const directSnap = await db.collection('reports').doc(trimmed).get();
  if (directSnap.exists) {
    return {reports: [toReportListItem(directSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  // No orderBy here deliberately — a single-field equality filter needs no
  // composite index, and adding one just to sort a handful of duplicate
  // reports isn't worth it (avoid unnecessary indexes, per convention).
  const byTargetSnap = await db.collection('reports').where('targetId', '==', trimmed).limit(SEARCH_LIMIT).get();
  return {reports: byTargetSnap.docs.map(toReportListItem)};
});
