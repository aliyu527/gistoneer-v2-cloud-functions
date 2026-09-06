import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';

export type AdminAuditAction = 'user.suspend' | 'user.unsuspend';

interface AdminAuditLogInput {
  actorUid: string;
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: 'user';
  targetUid: string;
  reason: string | null;
}

/**
 * First audit-log mechanism in this codebase. Best-effort by design — every
 * caller wraps this in `.catch(() => {})` so a logging failure never blocks
 * the actual admin action it's recording (the action already happened by the
 * time this is called).
 */
export async function writeAuditLog(entry: AdminAuditLogInput): Promise<void> {
  await db.collection('adminAuditLogs').add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}
