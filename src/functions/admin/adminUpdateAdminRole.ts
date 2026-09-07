import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {countActiveSuperAdmins} from './adminUsersShared';
import {requireActiveAdmin} from './requireActiveAdmin';
import {enforceRateLimit} from '../../lib/rateLimit';
import {writeAuditLog} from './writeAuditLog';
import type {AdminRole} from './bootstrapAdmin';

const VALID_ROLES: AdminRole[] = ['super_admin', 'admin', 'moderator', 'support'];

interface AdminUpdateAdminRoleRequest {
  targetUid: string;
  role: AdminRole;
}

interface AdminUpdateAdminRoleResponse {
  uid: string;
  role: AdminRole;
}

/**
 * Self-target is always rejected outright (Decision 4 — the simplest,
 * safest self-lockout guard, mirrors suspendUser.ts's own self-suspend
 * block exactly) rather than trying to reason about whether a given
 * self-change would actually be safe. Demoting the sole active super_admin
 * is rejected via countActiveSuperAdmins() — the one scenario that could
 * leave admins.manage uncallable by anyone (it's exclusively a super_admin
 * permission in the current ROLE_PERMISSIONS map).
 */
export const adminUpdateAdminRole = onCall<AdminUpdateAdminRoleRequest, Promise<AdminUpdateAdminRoleResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'admins.manage');
  await enforceRateLimit(admin.uid, 'adminUpdateAdminRole', {maxPerWindow: 20, windowMs: 10 * 60 * 1000});

  const targetUid = request.data?.targetUid;
  const role = request.data?.role;
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing targetUid.');
  }
  if (!role || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid role.');
  }
  if (targetUid === admin.uid) {
    throw new HttpsError('invalid-argument', "You can't change your own role through this tool.");
  }

  const ref = db.collection('admins').doc(targetUid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This administrator could not be found.');
  }
  const data = snap.data()!;
  const previousRole = (data.role as AdminRole) ?? 'support';
  const previousStatus = (data.status as string) ?? 'active';

  if (previousRole === role) {
    throw new HttpsError('failed-precondition', 'This administrator already has that role.');
  }

  if (previousRole === 'super_admin' && previousStatus === 'active' && role !== 'super_admin') {
    const activeSuperAdmins = await countActiveSuperAdmins();
    if (activeSuperAdmins <= 1) {
      throw new HttpsError('failed-precondition', 'This is the only active super admin — assign another super admin before changing this role.');
    }
  }

  await auth.setCustomUserClaims(targetUid, {admin: true, role});
  await ref.update({role, updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: targetUid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'admin_role_changed',
    reason: `Your admin role changed from ${previousRole} to ${role}.`,
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'admin.role_change',
    targetType: 'admin',
    targetId: targetUid,
    reason: `${previousRole} → ${role}`,
  }).catch(() => {});

  return {uid: targetUid, role};
});
