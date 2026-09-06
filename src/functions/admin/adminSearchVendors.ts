import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {toVendorListItem, type AdminVendorListItem} from './adminListVendors';

interface AdminSearchVendorsRequest {
  query: string;
}

interface AdminSearchVendorsResponse {
  vendors: AdminVendorListItem[];
}

/** Same exact-lookup pattern as every prior search function: exact vendor (== uid) doc id, or exact @username resolved to that user's vendor doc. */
export const adminSearchVendors = onCall<AdminSearchVendorsRequest, Promise<AdminSearchVendorsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const raw = request.data?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Missing search query.');
  }
  const trimmed = raw.trim();

  const directSnap = await db.collection('vendors').doc(trimmed).get();
  if (directSnap.exists) {
    return {vendors: [toVendorListItem(directSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
  }

  const username = trimmed.replace(/^@/, '').trim().toLowerCase();
  if (username.length === 0) return {vendors: []};

  const userSnap = await db.collection('users').where('usernameLower', '==', username).limit(1).get();
  if (userSnap.empty) return {vendors: []};

  const vendorSnap = await db.collection('vendors').doc(userSnap.docs[0].id).get();
  if (!vendorSnap.exists) return {vendors: []};

  return {vendors: [toVendorListItem(vendorSnap as FirebaseFirestore.QueryDocumentSnapshot)]};
});
