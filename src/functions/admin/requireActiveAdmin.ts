import {HttpsError, type CallableRequest} from 'firebase-functions/v2/https';
import {db} from '../../admin';

interface ActiveAdmin {
  uid: string;
  email: string | null;
}

/**
 * Fast custom-claim check plus a re-read of admins/{uid}.status, for actions
 * consequential enough not to trust a claim that can be up to ~1hr stale in
 * an already-cached ID token (same staleness concern getAdminSession.ts
 * guards against). Read-only admin functions (the dashboard ones,
 * adminListUsers, etc.) intentionally skip this and use the fast claim check
 * alone — this re-check is reserved for actions that mutate account state.
 */
export async function requireActiveAdmin(request: CallableRequest): Promise<ActiveAdmin> {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const snap = await db.collection('admins').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const status = (snap.data()!.status as string) ?? 'active';
  if (status !== 'active') {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  return {uid: request.auth.uid, email: request.auth.token.email ?? null};
}
