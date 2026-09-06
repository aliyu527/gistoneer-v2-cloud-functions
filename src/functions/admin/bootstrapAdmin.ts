import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';

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
 * The only way any admin ever gets provisioned before Module 12 builds a
 * real invitation UI — deliberately NOT a public "/register-admin" (spec
 * explicitly forbids that). Gated by the exact same hardcoded-operator-email
 * check as backfillSoundVisibility.ts, so it's safe to leave deployed
 * permanently rather than one-shot: nobody but that account can ever call
 * it, regardless of what the client sends.
 */
export const bootstrapAdmin = onCall<BootstrapAdminRequest, Promise<BootstrapAdminResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth || request.auth.token.email !== ALLOWED_EMAIL) {
      throw new HttpsError('permission-denied', 'Not authorized.');
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

    return {uid: targetUid, role};
  },
);
