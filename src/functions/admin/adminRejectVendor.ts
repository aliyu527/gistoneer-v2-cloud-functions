import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminRejectVendorRequest {
  vendorId: string;
  reason: string;
}

interface AdminRejectVendorResponse {
  vendorId: string;
  status: 'rejected';
}

export const adminRejectVendor = onCall<AdminRejectVendorRequest, Promise<AdminRejectVendorResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.vendors.manage');

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
    throw new HttpsError('not-found', 'This vendor application could not be found.');
  }
  if (vendorSnap.data()?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only a pending application can be rejected.');
  }

  await vendorRef.update({
    status: 'rejected',
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: admin.email,
    rejectionReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await createNotification({
    recipientId: vendorId,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'vendor_rejected',
    reason,
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'vendor.reject',
    targetType: 'vendor',
    targetId: vendorId,
    reason,
  }).catch(() => {});

  return {vendorId, status: 'rejected'};
});
