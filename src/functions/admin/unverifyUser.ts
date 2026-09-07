import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface UnverifyUserRequest {
  uid: string;
}

interface UnverifyUserResponse {
  uid: string;
  isVerified: false;
}

export const unverifyUser = onCall<UnverifyUserRequest, Promise<UnverifyUserResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'users.verify');

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'This user could not be found.');
  }
  if (userSnap.data()?.isVerified !== true) {
    throw new HttpsError('failed-precondition', 'This user is not currently verified.');
  }

  await userRef.update({
    isVerified: false,
    verifiedAt: FieldValue.delete(),
    verifiedBy: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await createNotification({
    recipientId: uid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'user_unverified',
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'user.unverify',
    targetType: 'user',
    targetId: uid,
    reason: null,
  }).catch(() => {});

  return {uid, isVerified: false};
});
