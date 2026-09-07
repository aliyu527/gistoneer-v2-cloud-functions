import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {ROLE_PERMISSIONS, type Permission} from './permissions';
import type {AdminAccountListItem} from './adminListAdmins';
import type {AdminRole} from './bootstrapAdmin';

export interface AdminAccountDetail extends AdminAccountListItem {
  createdBy: string | null;
  /** Computed server-side from ROLE_PERMISSIONS — the honest, current source of truth, never trusted from the client. */
  effectivePermissions: Permission[];
}

interface AdminGetAdminDetailRequest {
  uid: string;
}

export const adminGetAdminDetail = onCall<AdminGetAdminDetailRequest, Promise<AdminAccountDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'admins.read');

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }

  const snap = await db.collection('admins').doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This administrator could not be found.');
  }
  const data = snap.data()!;
  const role = (data.role as AdminRole) ?? 'support';

  return {
    uid: snap.id,
    email: (data.email as string) ?? null,
    role,
    status: (data.status as AdminAccountDetail['status']) ?? 'active',
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    lastLoginAt: data.lastLoginAt?.toDate?.().toISOString() ?? null,
    createdBy: (data.createdBy as string) ?? null,
    effectivePermissions: ROLE_PERMISSIONS[role] ?? [],
  };
});
