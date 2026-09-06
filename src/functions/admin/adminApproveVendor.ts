import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminApproveVendorRequest {
  vendorId: string;
}

interface AdminApproveVendorResponse {
  vendorId: string;
  status: 'approved';
}

export const adminApproveVendor = onCall<AdminApproveVendorRequest, Promise<AdminApproveVendorResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.vendors.manage');

  const vendorId = request.data?.vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing vendorId.');
  }

  const vendorRef = db.collection('vendors').doc(vendorId);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) {
    throw new HttpsError('not-found', 'This vendor application could not be found.');
  }
  if (vendorSnap.data()?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only a pending application can be approved.');
  }

  await vendorRef.update({
    status: 'approved',
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: admin.email,
    updatedAt: FieldValue.serverTimestamp(),
    rejectionReason: FieldValue.delete(),
  });

  await createNotification({
    recipientId: vendorId,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'vendor_approved',
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'vendor.approve',
    targetType: 'vendor',
    targetId: vendorId,
    reason: null,
  }).catch(() => {});

  return {vendorId, status: 'approved'};
});
