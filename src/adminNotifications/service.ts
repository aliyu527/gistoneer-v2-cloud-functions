import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {ROLE_PERMISSIONS, roleHasPermission, type Permission} from '../functions/admin/permissions';
import type {AdminRole} from '../functions/admin/bootstrapAdmin';
import type {AdminNotificationCategory, AdminNotificationPriority, AdminNotificationType} from './types';

export interface NotifyAdminsInput {
  type: AdminNotificationType;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  targetPermission: Permission;
  resourceType?: string;
  resourceId?: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
  /** uids to never notify — always includes the acting admin (mirrors notifications/service.ts's own self-notification guard), and for admin-lifecycle events also the target admin (who already gets their own personal copy via the existing createNotification call in that same function). */
  excludeUids?: string[];
  /** The uid of the actor who triggered the underlying event (may be an end user, e.g. a vendor applicant — not necessarily an admin). Stored as-is for display; `null` when there's no meaningful single actor. */
  createdBy: string | null;
}

/**
 * Resolves eligible admins by permission (reusing the existing hardcoded
 * ROLE_PERMISSIONS map — no new targeting concept) rather than a Firestore
 * `role in [...]` query: admin counts are small enough that fetch-all-active
 * then filter in-memory is simpler and just as cheap. No Cloud Functions
 * triggers/event bus — every call site is a plain function call at the exact
 * point its source function's real action just succeeded, so there's no
 * trigger chain to recurse and no retry-duplication risk beyond what that
 * source function's own business logic already guards against.
 */
export async function notifyAdmins(input: NotifyAdminsInput): Promise<void> {
  const eligibleRoles = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((role) => roleHasPermission(role, input.targetPermission));
  if (eligibleRoles.length === 0) return;

  const snap = await db.collection('admins').where('status', '==', 'active').where('role', 'in', eligibleRoles).get();

  const excluded = new Set(input.excludeUids ?? []);
  const recipientUids = snap.docs.map((doc) => doc.id).filter((uid) => !excluded.has(uid));
  if (recipientUids.length === 0) return;

  await Promise.all(
    recipientUids.map((recipientId) =>
      db.collection('adminNotifications').add({
        recipientId,
        type: input.type,
        category: input.category,
        priority: input.priority,
        title: input.title,
        message: input.message,
        ...(input.resourceType ? {resourceType: input.resourceType} : {}),
        ...(input.resourceId ? {resourceId: input.resourceId} : {}),
        actionUrl: input.actionUrl,
        ...(input.metadata ? {metadata: input.metadata} : {}),
        isRead: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: input.createdBy,
      }),
    ),
  );
}
