import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface RestoreSoundRequest {
  soundId: string;
}

interface RestoreSoundResponse {
  soundId: string;
  moderationStatus: 'active';
}

/** Single permission tier (sounds.moderate) for hide/restore/remove alike — unlike content, there's no sounds.delete-equivalent to split severity on. */
export const restoreSound = onCall<RestoreSoundRequest, Promise<RestoreSoundResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'sounds.moderate');

  const soundId = request.data?.soundId;
  if (typeof soundId !== 'string' || soundId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing soundId.');
  }

  const soundRef = db.collection('sounds').doc(soundId);
  const soundSnap = await soundRef.get();
  if (!soundSnap.exists) {
    throw new HttpsError('not-found', 'This sound could not be found.');
  }

  await soundRef.update({moderationStatus: 'active', updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'sound.restore',
    targetType: 'sound',
    targetId: soundId,
    reason: null,
  }).catch(() => {});

  return {soundId, moderationStatus: 'active'};
});
