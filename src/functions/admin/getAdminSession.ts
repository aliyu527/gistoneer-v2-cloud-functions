import {onCall} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import type {AdminRole} from './bootstrapAdmin';

interface GetAdminSessionResponse {
  isAdmin: boolean;
  role: AdminRole | null;
  status: 'active' | 'suspended' | 'disabled' | null;
}

/**
 * The real authorization check, called once per login/app-load (never per
 * navigation — cached client-side in AuthContext). The custom claim
 * (`admin: true`) is the fast unforgeable signal a client can never fake,
 * but claims can be up to ~1hr stale in an already-cached ID token, so this
 * also re-reads admins/{uid}.status on every call — catches a suspended
 * admin immediately instead of waiting for their token to naturally refresh.
 * Not an admin at all -> return the negative result rather than throwing,
 * so a plain authenticated (non-admin) user gets a normal, quiet "no" (no
 * error, no information about whether an admins doc exists for anyone else).
 */
export const getAdminSession = onCall<undefined, Promise<GetAdminSessionResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const NOT_ADMIN: GetAdminSessionResponse = {isAdmin: false, role: null, status: null};

  if (!request.auth) return NOT_ADMIN;
  if (request.auth.token.admin !== true) return NOT_ADMIN;

  const snap = await db.collection('admins').doc(request.auth.uid).get();
  if (!snap.exists) return NOT_ADMIN;

  const data = snap.data()!;
  const status = (data.status as GetAdminSessionResponse['status']) ?? 'active';
  const role = (data.role as AdminRole) ?? null;

  if (status !== 'active') {
    return {isAdmin: false, role, status};
  }

  // Best-effort — a failed write here shouldn't block a legitimate admin from getting in.
  await snap.ref.update({lastLoginAt: FieldValue.serverTimestamp()}).catch(() => {});

  return {isAdmin: true, role, status};
});
