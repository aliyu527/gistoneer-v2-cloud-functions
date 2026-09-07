import {db} from '../../admin';

/** The one genuinely shared piece of logic across adminUpdateAdminRole/adminSuspendAdmin — used to reject any operation that would leave the platform with zero active super_admins. */
export async function countActiveSuperAdmins(): Promise<number> {
  const snap = await db.collection('admins').where('role', '==', 'super_admin').where('status', '==', 'active').count().get();
  return snap.data().count;
}
