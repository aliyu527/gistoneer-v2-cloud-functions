import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface VerifyUserRequest {
  uid: string;
}

interface VerifyUserResponse {
  uid: string;
  isVerified: true;
}

/** Mirrors unsuspendUser.ts's shape — Firestore-only mutation, no Auth record involved. isVerified is a canonical platform attribute on users/{uid}, never client-writable (the existing rule already restricts self-updates to displayName/photoURL/updatedAt only). */
export const verifyUser = onCall<VerifyUserRequest, Promise<VerifyUserResponse>>({cors: true, region: 'us-central1'}, async (request) => {
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
  if (userSnap.data()?.isVerified === true) {
    throw new HttpsError('failed-precondition', 'This user is already verified.');
  }

  await userRef.update({
    isVerified: true,
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedBy: admin.email,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await createNotification({
    recipientId: uid,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'user_verified',
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'user.verify',
    targetType: 'user',
    targetId: uid,
    reason: null,
  }).catch(() => {});

  return {uid, isVerified: true};
});
