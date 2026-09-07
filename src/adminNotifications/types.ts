import type {Timestamp} from 'firebase-admin/firestore';

export type AdminNotificationCategory = 'marketplace' | 'moderation' | 'admin' | 'settings';
export type AdminNotificationPriority = 'normal' | 'high' | 'critical';

export type AdminNotificationType =
  | 'vendor.application_created'
  | 'report.submitted'
  | 'admin.created'
  | 'admin.role_changed'
  | 'admin.suspended'
  | 'admin.reactivated'
  | 'settings.maintenance_enabled'
  | 'settings.feature_disabled';

export interface AdminNotification {
  id: string;
  recipientId: string;
  type: AdminNotificationType;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  readAt: Timestamp | null;
  createdAt: Timestamp;
  createdBy: string | null;
}
