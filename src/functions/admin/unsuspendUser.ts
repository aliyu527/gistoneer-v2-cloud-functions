import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface UnsuspendUserRequest {
  uid: string;
}

interface UnsuspendUserResponse {
  uid: string;
  status: 'active';
}

export const unsuspendUser = onCall<UnsuspendUserRequest, Promise<UnsuspendUserResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'users.suspend');

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'This user could not be found.');
  }

  await userRef.update({status: 'active', updatedAt: FieldValue.serverTimestamp()});

  try {
    await auth.updateUser(uid, {disabled: false});
  } catch (error) {
    throw new HttpsError('internal', 'Account status was restored, but re-enabling sign-in failed. Please try again.');
  }

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'user.unsuspend',
    targetType: 'user',
    targetId: uid,
    reason: null,
  }).catch(() => {});

  return {uid, status: 'active'};
});
