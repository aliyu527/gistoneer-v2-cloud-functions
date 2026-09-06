import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toLiveSessionListItem, type AdminLiveSessionListItem} from './adminListLiveSessions';

interface AdminSearchLiveSessionsRequest {
  query: string;
}

interface AdminSearchLiveSessionsResponse {
  sessions: AdminLiveSessionListItem[];
}

const SEARCH_LIMIT = 20;

/** Same exact-lookup pattern as every prior search function: exact liveId, or exact @username resolved to that host's sessions. */
export const adminSearchLiveSessions = onCall<AdminSearchLiveSessionsRequest, Promise<AdminSearchLiveSessionsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'live.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const sessionSnap = await db.collection('liveSessions').doc(trimmed).get();
  if (sessionSnap.exists) {
    return {sessions: [toLiveSessionListItem(sessionSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  const username = trimmed.replace(/^@/, '').trim().toLowerCase();
  if (username.length === 0) return {sessions: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {sessions: []};

  const snap = await db.collection('liveSessions').where('hostId', '==', userSnap.docs[0].id).orderBy('updatedAt', 'desc').limit(SEARCH_LIMIT).get();
  return {sessions: snap.docs.map(toLiveSessionListItem)};
});
