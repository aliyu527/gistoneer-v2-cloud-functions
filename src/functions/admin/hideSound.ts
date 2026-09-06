import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface HideSoundRequest {
  soundId: string;
  reason: string;
}

interface HideSoundResponse {
  soundId: string;
  moderationStatus: 'hidden';
}

/** Enforcement is the narrowed firestore.rules read condition on sounds/{soundId} — never touches referencing posts/playlists (they already carry their own denormalized/self-contained data). */
export const hideSound = onCall<HideSoundRequest, Promise<HideSoundResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'sounds.moderate');

  const soundId = request.data?.soundId;
  const reason = request.data?.reason;
  if (typeof soundId !== 'string' || soundId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing soundId.');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const soundRef = db.collection('sounds').doc(soundId);
  const soundSnap = await soundRef.get();
  if (!soundSnap.exists) {
    throw new HttpsError('not-found', 'This sound could not be found.');
  }

  await soundRef.update({moderationStatus: 'hidden', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'sound.hide',
    targetType: 'sound',
    targetId: soundId,
    reason: reason.trim(),
  }).catch(() => {});

  return {soundId, moderationStatus: 'hidden'};
});
