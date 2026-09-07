import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {writeAuditLog} from './writeAuditLog';

/** The one deploy account — there's no admin/role system anywhere in this codebase to reuse (same gate backfillSoundVisibility.ts already uses). Only this account can ever grant the admin custom claim. */
const ALLOWED_EMAIL = 'gistoneer@gmail.com';

export type AdminRole = 'super_admin' | 'admin' | 'moderator' | 'support';
const VALID_ROLES: AdminRole[] = ['super_admin', 'admin', 'moderator', 'support'];

interface BootstrapAdminRequest {
  /** Defaults to the caller's own uid when omitted — the common "grant myself admin" case. */
  targetUid?: string;
  targetEmail?: string;
  role?: AdminRole;
}

interface BootstrapAdminResponse {
  uid: string;
  role: AdminRole;
}

/**
 * Module 14: hardened from "permanently deployed, gated only by one hardcoded
 * email" (a single compromised Gmail session could otherwise mint arbitrary
 * super_admins forever) into a true ONE-TIME bootstrap — it now refuses to
 * run at all once any active admin already exists, since Module 12's real
 * Add Administrator flow (adminAddAdmin.ts) is the correct path from that
 * point on. Safe to leave deployed permanently: the hardcoded-email gate
 * still applies for the one legitimate call (fresh project, zero admins),
 * and every call after that is a no-op regardless of who calls it.
 */
export const bootstrapAdmin = onCall<BootstrapAdminRequest, Promise<BootstrapAdminResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth || request.auth.token.email !== ALLOWED_EMAIL) {
      throw new HttpsError('permission-denied', 'Not authorized.');
    }

    const existingActiveAdmin = await db.collection('admins').where('status', '==', 'active').limit(1).get();
    if (!existingActiveAdmin.empty) {
      throw new HttpsError('failed-precondition', 'Bootstrap already completed — use Add Administrator in the Admin Panel to grant access to additional users.');
    }

    const role = request.data?.role ?? 'super_admin';
    if (!VALID_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid role.');
    }

    let targetUid = request.data?.targetUid;
    let targetEmail = request.data?.targetEmail;

    if (!targetUid) {
      if (targetEmail) {
        const userRecord = await auth.getUserByEmail(targetEmail).catch(() => null);
        if (!userRecord) {
          throw new HttpsError('not-found', 'No Firebase Auth user exists for that email yet — create one in the Firebase Console first.');
        }
        targetUid = userRecord.uid;
      } else {
        targetUid = request.auth.uid;
        targetEmail = request.auth.token.email;
      }
    }

    if (!targetEmail) {
      const userRecord = await auth.getUser(targetUid);
      targetEmail = userRecord.email;
    }

    await auth.setCustomUserClaims(targetUid, {admin: true, role});

    const adminRef = db.collection('admins').doc(targetUid);
    const existing = await adminRef.get();

    await adminRef.set(
      {
        uid: targetUid,
        email: targetEmail ?? null,
        role,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
      },
      {merge: true},
    );

    await writeAuditLog({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email ?? null,
      action: 'admin.create',
      targetType: 'admin',
      targetId: targetUid,
      reason: 'Initial admin bootstrap',
    }).catch(() => {});

    return {uid: targetUid, role};
  },
);
