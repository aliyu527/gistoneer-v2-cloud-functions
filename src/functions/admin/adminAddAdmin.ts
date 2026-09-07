import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';
import type {AdminRole} from './bootstrapAdmin';

const VALID_ROLES: AdminRole[] = ['super_admin', 'admin', 'moderator', 'support'];

interface AdminAddAdminRequest {
  targetUid: string;
  role: AdminRole;
}

interface AdminAddAdminResponse {
  uid: string;
  role: AdminRole;
}

/**
 * Promotes an existing Firebase Auth / Gistoneer user to admin — there's no
 * email-invitation flow here (no email-sending infrastructure exists
 * anywhere in this codebase), so the frontend resolves the target via
 * adminSearchUsers (Module 04) first and only ever sends a uid. The target's
 * email is re-resolved from Firebase Auth here, never trusted from the
 * client. Mirrors bootstrapAdmin.ts's own claim + Firestore write, just
 * gated by admins.manage (super_admin only, per the existing permission
 * map) instead of the one hardcoded operator email.
 */
export const adminAddAdmin = onCall<AdminAddAdminRequest, Promise<AdminAddAdminResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'admins.manage');

  const targetUid = request.data?.targetUid;
  const role = request.data?.role;
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing targetUid.');
  }
  if (!role || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid role.');
  }

  const existing = await db.collection('admins').doc(targetUid).get();
  if (existing.exists) {
    throw new HttpsError('failed-precondition', 'This user is already an administrator — change their role instead.');
  }

  const userRecord = await auth.getUser(targetUid).catch(() => null);
  if (!userRecord) {
    throw new HttpsError('not-found', 'No Firebase Auth user exists for that account.');
  }

  await auth.setCustomUserClaims(targetUid, {admin: true, role});

  await db.collection('admins').doc(targetUid).set({
    uid: targetUid,
    email: userRecord.email ?? null,
    role,
    status: 'active',
    createdBy: admin.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await createNotification({
    recipientId: targetUid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'admin_access_granted',
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'admin.create',
    targetType: 'admin',
    targetId: targetUid,
    reason: `Granted role: ${role}`,
  }).catch(() => {});

  return {uid: targetUid, role};
});
