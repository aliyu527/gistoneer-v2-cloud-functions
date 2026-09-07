import {FieldValue} from 'firebase-admin/firestore';
import {logger} from 'firebase-functions/v2';
import {db} from '../../admin';

export type AdminAuditAction =
  | 'user.suspend'
  | 'user.unsuspend'
  | 'content.hide'
  | 'content.restore'
  | 'content.remove'
  | 'sound.hide'
  | 'sound.restore'
  | 'sound.remove'
  | 'live.end'
  | 'live.chat.delete'
  | 'notification.send'
  | 'vendor.approve'
  | 'vendor.reject'
  | 'vendor.suspend'
  | 'vendor.restore'
  | 'listing.suspend'
  | 'listing.restore'
  | 'comment.hide'
  | 'comment.restore'
  | 'report.dismiss'
  | 'user.warn'
  | 'admin.create'
  | 'admin.role_change'
  | 'admin.suspend'
  | 'admin.reactivate'
  | 'admin.password_changed'
  | 'settings.update';

interface AdminAuditLogInput {
  actorUid: string;
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: 'user' | 'content' | 'sound' | 'live' | 'notification' | 'vendor' | 'listing' | 'comment' | 'report' | 'admin' | 'settings';
  targetId: string;
  reason: string | null;
  /** Module 08: lets a notification "campaign" carry its own rich record (title/body/audience/recipientCount) without a second collection — adminAuditLogs is already the source of truth for "who did what, when." */
  metadata?: Record<string, unknown>;
  /** Pre-generated id (e.g. via db.collection('adminAuditLogs').doc().id) — lets a caller know the doc id BEFORE writing, for cases like Module 08's per-recipient notification docs needing the campaign id as their own idempotency-key suffix. Omit for a fresh auto-id (every prior call site). */
  docId?: string;
}

/**
 * First audit-log mechanism in this codebase (Module 04). Best-effort by
 * design — every caller wraps this in `.catch(() => {})` so a logging
 * failure never blocks the actual admin action it's recording (the action
 * already happened by the time this is called). Returns the resulting doc's
 * id (harmless addition — every existing caller already ignores the return
 * value).
 *
 * Module 14: the Firestore write itself is now wrapped internally — a
 * failure is logged via logger.error (surfaces in Cloud Logging/alerting)
 * instead of vanishing silently into a caller's `.catch(() => {})`. Still
 * never throws, so no existing call site needs to change.
 */
export async function writeAuditLog(entry: AdminAuditLogInput): Promise<string> {
  const {docId, ...rest} = entry;
  const payload = {...rest, createdAt: FieldValue.serverTimestamp()};
  try {
    if (docId) {
      await db.collection('adminAuditLogs').doc(docId).set(payload);
      return docId;
    }
    const ref = await db.collection('adminAuditLogs').add(payload);
    return ref.id;
  } catch (error) {
    logger.error('writeAuditLog failed', {action: entry.action, targetType: entry.targetType, targetId: entry.targetId, actorUid: entry.actorUid, error});
    return docId ?? '';
  }
}
