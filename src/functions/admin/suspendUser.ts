import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface SuspendUserRequest {
  uid: string;
  reason: string;
}

interface SuspendUserResponse {
  uid: string;
  status: 'suspended';
}

/**
 * Suspends both at the Firebase Auth level (auth.updateUser disabled: true —
 * this is what actually blocks sign-in/token refresh; the mobile app already
 * has a mapped error message for the resulting auth/user-disabled error) and
 * mirrors it into users/{uid}.status so the admin UI (and any future
 * client-side gate) can read status without needing a failed sign-in.
 * Auth-disable happens first: if the Firestore write fails afterward, the
 * user is still safely locked out rather than silently not suspended.
 */
export const suspendUser = onCall<SuspendUserRequest, Promise<SuspendUserResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request);

  const uid = request.data?.uid;
  const reason = request.data?.reason;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'A suspension reason is required.');
  }
  if (uid === admin.uid) {
    throw new HttpsError('invalid-argument', "You can't suspend your own account through this tool.");
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'This user could not be found.');
  }

  try {
    await auth.updateUser(uid, {disabled: true});
  } catch (error) {
    throw new HttpsError('internal', 'Unable to suspend this user. Please try again.');
  }

  await userRef.update({status: 'suspended', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'user.suspend',
    targetType: 'user',
    targetUid: uid,
    reason: reason.trim(),
  }).catch(() => {});

  return {uid, status: 'suspended'};
});
