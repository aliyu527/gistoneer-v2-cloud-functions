import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminReactivateAdminRequest {
  targetUid: string;
}

interface AdminReactivateAdminResponse {
  uid: string;
  status: 'active';
}

export const adminReactivateAdmin = onCall<AdminReactivateAdminRequest, Promise<AdminReactivateAdminResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'admins.manage');

  const targetUid = request.data?.targetUid;
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing targetUid.');
  }

  const ref = db.collection('admins').doc(targetUid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This administrator could not be found.');
  }
  if (snap.data()?.status !== 'suspended') {
    throw new HttpsError('failed-precondition', 'Only a suspended administrator can be reactivated.');
  }

  await ref.update({status: 'active', updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: targetUid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'admin_reactivated',
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'admin.reactivate',
    targetType: 'admin',
    targetId: targetUid,
    reason: null,
  }).catch(() => {});

  return {uid: targetUid, status: 'active'};
});
