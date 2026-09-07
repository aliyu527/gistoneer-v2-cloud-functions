import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdminAny} from './requireActiveAdmin';

interface GetMyAdminProfileResponse {
  uid: string;
  email: string | null;
  role: string | null;
  status: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  createdBy: string | null;
  displayName: string | null;
  photoURL: string | null;
}

/** Self-scoped by construction (request.auth.uid) — no permission beyond "is an active admin", so every role can view their own profile, matching /dashboard and the notification inbox's own precedent. Combines admins/{uid} (RBAC record) and users/{uid} (display identity) into one response so the frontend needs a single call. */
export const getMyAdminProfile = onCall<undefined, Promise<GetMyAdminProfileResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdminAny(request);

  const [adminSnap, userSnap] = await Promise.all([db.collection('admins').doc(admin.uid).get(), db.collection('users').doc(admin.uid).get()]);

  const adminData = adminSnap.data();
  const userData = userSnap.data();

  return {
    uid: admin.uid,
    email: admin.email,
    role: admin.role,
    status: (adminData?.status as string) ?? 'active',
    createdAt: adminData?.createdAt?.toDate?.().toISOString() ?? null,
    lastLoginAt: adminData?.lastLoginAt?.toDate?.().toISOString() ?? null,
    createdBy: (adminData?.createdBy as string) ?? null,
    displayName: (userData?.displayName as string) ?? null,
    photoURL: (userData?.photoURL as string) ?? null,
  };
});
