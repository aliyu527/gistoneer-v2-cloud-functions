import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toAdminListingListItem, type AdminListingListItem} from './adminListListings';

const SEARCH_LIMIT = 20;

interface AdminSearchListingsRequest {
  query: string;
}

interface AdminSearchListingsResponse {
  listings: AdminListingListItem[];
}

/** Exact listingId, or exact @vendor-username resolved to that vendor's listings. No free-text title search (no titleLower field), same limitation as every other content-search function in this admin panel. */
export const adminSearchListings = onCall<AdminSearchListingsRequest, Promise<AdminSearchListingsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const listingSnap = await db.collection('listings').doc(trimmed).get();
  if (listingSnap.exists) {
    return {listings: [toAdminListingListItem(listingSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  const username = trimmed.replace(/^@/, '').trim().toLowerCase();
  if (username.length === 0) return {listings: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {listings: []};

  const snap = await db.collection('listings').where('vendorId', '==', userSnap.docs[0].id).orderBy('createdAt', 'desc').limit(SEARCH_LIMIT).get();
  return {listings: snap.docs.map(toAdminListingListItem)};
});
