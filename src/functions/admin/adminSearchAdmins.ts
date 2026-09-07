import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toAdminAccountListItem, type AdminAccountListItem} from './adminListAdmins';

interface AdminSearchAdminsRequest {
  query: string;
}

interface AdminSearchAdminsResponse {
  admins: AdminAccountListItem[];
}

/** Exact uid (the admins doc id), or exact email — same exact-match convention as every other search function in this admin panel. Small admin population, so no substring/prefix search is needed. */
export const adminSearchAdmins = onCall<AdminSearchAdminsRequest, Promise<AdminSearchAdminsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'admins.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const directSnap = await db.collection('admins').doc(trimmed).get();
  if (directSnap.exists) {
    return {admins: [toAdminAccountListItem(directSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  const emailSnap = await db.collection('admins').where('email', '==', trimmed).limit(20).get();
  return {admins: emailSnap.docs.map(toAdminAccountListItem)};
});
