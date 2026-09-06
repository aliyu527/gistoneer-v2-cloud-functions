import {HttpsError, type CallableRequest} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {roleHasPermission, type Permission} from './permissions';
import type {AdminRole} from './bootstrapAdmin';

export interface ActiveAdmin {
  uid: string;
  email: string | null;
  role: AdminRole | null;
}

/**
 * Fast custom-claim check plus a re-read of admins/{uid}.status (claims can
 * be up to ~1hr stale in an already-cached ID token — same concern
 * getAdminSession.ts guards against). Does NOT check a specific permission —
 * use this directly only when the required permission depends on data you
 * haven't read yet (see restoreContent.ts); every other call site should use
 * requireActiveAdmin() below instead.
 */
export async function requireActiveAdminAny(request: CallableRequest): Promise<ActiveAdmin> {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const snap = await db.collection('admins').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const data = snap.data()!;
  const status = (data.status as string) ?? 'active';
  if (status !== 'active') {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const role = (data.role as AdminRole) ?? null;
  return {uid: request.auth.uid, email: request.auth.token.email ?? null, role};
}

/** Throws unless `admin.role` grants `permission` — the specific role (embedded in the Firebase-signed custom claim, so trustworthy) must be cross-checked server-side, or a lower-privileged role could call a privileged function directly and bypass what the client only hides via PermissionGuard. */
export function assertPermission(admin: ActiveAdmin, permission: Permission): void {
  if (!roleHasPermission(admin.role, permission)) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }
}

/** Convenience wrapper for the common case: the required permission is known up front. */
export async function requireActiveAdmin(request: CallableRequest, permission: Permission): Promise<ActiveAdmin> {
  const admin = await requireActiveAdminAny(request);
  assertPermission(admin, permission);
  return admin;
}
