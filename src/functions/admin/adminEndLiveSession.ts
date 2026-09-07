import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {stopRecordingIfActive} from '../../live/service';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminEndLiveSessionRequest {
  liveId: string;
  reason?: string;
}

interface AdminEndLiveSessionResponse {
  liveId: string;
  status: 'ended';
}

/**
 * Admin-initiated end, bypassing endLiveSession.ts's host-only ownership
 * check (getOwnedLiveSession requires hostId === caller, no admin bypass
 * exists there). Reuses stopRecordingIfActive(liveId) directly from
 * live/service.ts rather than reimplementing Agora Cloud Recording stop
 * logic — that helper is already host-agnostic (only takes liveId).
 * Idempotent, matching the host function's own posture.
 */
export const adminEndLiveSession = onCall<AdminEndLiveSessionRequest, Promise<AdminEndLiveSessionResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'live.end');

  const liveId = request.data?.liveId;
  const reason = request.data?.reason;
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing liveId.');
  }

  const sessionRef = db.collection('liveSessions').doc(liveId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError('not-found', 'This live session could not be found.');
  }

  if (sessionSnap.data()?.status !== 'ended') {
    await sessionRef.update({status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
    await stopRecordingIfActive(liveId);

    await createNotification({
      recipientId: sessionSnap.data()!.hostId as string,
      actorId: 'system',
      actorOverride: {displayName: 'Gistoneer'},
      type: 'live_ended_by_admin',
      liveId,
      reason: reason?.trim() || undefined,
    }).catch(() => {});
  }

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'live.end',
    targetType: 'live',
    targetId: liveId,
    reason: reason?.trim() || null,
  }).catch(() => {});

  return {liveId, status: 'ended'};
});
