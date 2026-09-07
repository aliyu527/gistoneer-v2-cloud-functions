import {onCall} from 'firebase-functions/v2/https';
import {requireActiveAdminAny} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface LogAdminPasswordChangedResponse {
  logged: true;
}

/**
 * Password changes happen entirely client-side via Firebase Auth
 * (reauthenticateWithCredential + updatePassword) — this callable performs
 * no mutation at all, it exists solely so the event lands in the existing
 * audit log. The client calls this once, best-effort, immediately after a
 * successful client-side password change.
 */
export const logAdminPasswordChanged = onCall<undefined, Promise<LogAdminPasswordChangedResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdminAny(request);

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'admin.password_changed',
    targetType: 'admin',
    targetId: admin.uid,
    reason: null,
  }).catch(() => {});

  return {logged: true};
});
