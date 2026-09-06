import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {cascadeVendorStatusToListings} from '../../marketplace/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminRestoreVendorRequest {
  vendorId: string;
}

interface AdminRestoreVendorResponse {
  vendorId: string;
  status: 'approved';
}

export const adminRestoreVendor = onCall<AdminRestoreVendorRequest, Promise<AdminRestoreVendorResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.vendors.manage');

  const vendorId = request.data?.vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing vendorId.');
  }

  const vendorRef = db.collection('vendors').doc(vendorId);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) {
    throw new HttpsError('not-found', 'This vendor could not be found.');
  }
  if (vendorSnap.data()?.status !== 'suspended') {
    throw new HttpsError('failed-precondition', 'Only a suspended vendor can be restored.');
  }

  await vendorRef.update({status: 'approved', updatedAt: FieldValue.serverTimestamp()});
  await cascadeVendorStatusToListings(vendorId, 'approved');

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'vendor.restore',
    targetType: 'vendor',
    targetId: vendorId,
    reason: null,
  }).catch(() => {});

  return {vendorId, status: 'approved'};
});
