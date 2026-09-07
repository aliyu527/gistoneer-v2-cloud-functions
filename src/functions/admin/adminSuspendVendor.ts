import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {cascadeVendorStatusToListings} from '../../marketplace/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';
import {enforceRateLimit} from '../../lib/rateLimit';

interface AdminSuspendVendorRequest {
  vendorId: string;
  reason: string;
}

interface AdminSuspendVendorResponse {
  vendorId: string;
  status: 'suspended';
}

/** Only an 'approved' vendor can be suspended. Cascades vendorStatus:'suspended' onto every listing they own — the only way suspending them actually stops their products/services from showing up in browse/search (Firestore can't join to a live vendor doc in a query). */
export const adminSuspendVendor = onCall<AdminSuspendVendorRequest, Promise<AdminSuspendVendorResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.vendors.manage');
  await enforceRateLimit(admin.uid, 'adminSuspendVendor', {maxPerWindow: 30, windowMs: 10 * 60 * 1000});

  const vendorId = request.data?.vendorId;
  const reason = request.data?.reason?.trim();
  if (typeof vendorId !== 'string' || vendorId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing vendorId.');
  }
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const vendorRef = db.collection('vendors').doc(vendorId);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) {
    throw new HttpsError('not-found', 'This vendor could not be found.');
  }
  if (vendorSnap.data()?.status !== 'approved') {
    throw new HttpsError('failed-precondition', 'Only an approved vendor can be suspended.');
  }

  await vendorRef.update({status: 'suspended', updatedAt: FieldValue.serverTimestamp()});
  await cascadeVendorStatusToListings(vendorId, 'suspended');

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'vendor.suspend',
    targetType: 'vendor',
    targetId: vendorId,
    reason,
  }).catch(() => {});

  return {vendorId, status: 'suspended'};
});
