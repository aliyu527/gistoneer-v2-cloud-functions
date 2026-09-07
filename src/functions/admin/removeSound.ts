import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface RemoveSoundRequest {
  soundId: string;
  reason: string;
}

interface RemoveSoundResponse {
  soundId: string;
  moderationStatus: 'removed';
}

/**
 * Soft-delete only — sets moderationStatus:'removed', never deletes the S3
 * audio/artwork or the document (spec explicitly forbids treating a
 * moderation action as data destruction; sounds may be referenced by
 * existing posts' soundTrackIds/playlists' soundIds). Same permission tier
 * as hideSound — sounds has no content.delete-equivalent split permission.
 */
export const removeSound = onCall<RemoveSoundRequest, Promise<RemoveSoundResponse>>({cors: true, region: 'us-central1'}, async (request) => {
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

  await soundRef.update({moderationStatus: 'removed', updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: soundSnap.data()!.ownerId as string,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'sound_removed',
    soundId,
    reason: reason.trim(),
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'sound.remove',
    targetType: 'sound',
    targetId: soundId,
    reason: reason.trim(),
  }).catch(() => {});

  return {soundId, moderationStatus: 'removed'};
});
