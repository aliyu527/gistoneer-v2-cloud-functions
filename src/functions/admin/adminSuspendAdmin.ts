import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {countActiveSuperAdmins} from './adminUsersShared';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';
import type {AdminRole} from './bootstrapAdmin';

interface AdminSuspendAdminRequest {
  targetUid: string;
  reason: string;
}

interface AdminSuspendAdminResponse {
  uid: string;
  status: 'suspended';
}

/**
 * Admin-panel-scoped only (Decision 3) — sets admins/{uid}.status, which
 * requireActiveAdmin/getAdminSession already gate on. Deliberately never
 * touches auth.updateUser(disabled:true) the way suspendUser.ts does for
 * regular platform users: an admin is also a regular Gistoneer user, and
 * losing admin access must not also lock them out of the app itself.
 */
export const adminSuspendAdmin = onCall<AdminSuspendAdminRequest, Promise<AdminSuspendAdminResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'admins.manage');

  const targetUid = request.data?.targetUid;
  const reason = request.data?.reason?.trim();
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing targetUid.');
  }
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }
  if (targetUid === admin.uid) {
    throw new HttpsError('invalid-argument', "You can't suspend your own admin access through this tool.");
  }

  const ref = db.collection('admins').doc(targetUid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This administrator could not be found.');
  }
  const data = snap.data()!;
  if (data.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Only an active administrator can be suspended.');
  }

  const role = (data.role as AdminRole) ?? 'support';
  if (role === 'super_admin') {
    const activeSuperAdmins = await countActiveSuperAdmins();
    if (activeSuperAdmins <= 1) {
      throw new HttpsError('failed-precondition', 'This is the only active super admin — assign another super admin before suspending this one.');
    }
  }

  await ref.update({status: 'suspended', updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: targetUid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'admin_suspended',
    reason,
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'admin.suspend',
    targetType: 'admin',
    targetId: targetUid,
    reason,
  }).catch(() => {});

  return {uid: targetUid, status: 'suspended'};
});
