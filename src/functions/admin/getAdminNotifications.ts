import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdminAny} from './requireActiveAdmin';
import type {AdminNotificationCategory, AdminNotificationPriority, AdminNotificationType} from '../../adminNotifications/types';

interface GetAdminNotificationsRequest {
  isRead?: boolean;
  category?: AdminNotificationCategory;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

export interface AdminNotificationListItem {
  id: string;
  type: AdminNotificationType;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  actionUrl: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string | null;
}

interface GetAdminNotificationsResponse {
  entries: AdminNotificationListItem[];
  nextCursor: string | null;
}

/** Any active admin reads only their OWN inbox — no permission beyond being an active admin (matches /dashboard's own no-extra-permission precedent). isRead/category filters are mutually exclusive by design, same index-minimizing discipline as adminListAuditLogs.ts. */
export const getAdminNotifications = onCall<GetAdminNotificationsRequest, Promise<GetAdminNotificationsResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdminAny(request);

    const {isRead, category, sortDir = 'desc', cursor} = request.data ?? {};
    const pageSize = clampLimit(request.data?.pageSize, 50, 20);

    let q: Query<DocumentData> = db.collection('adminNotifications').where('recipientId', '==', admin.uid);
    if (isRead !== undefined) {
      q = q.where('isRead', '==', isRead);
    } else if (category) {
      q = q.where('category', '==', category);
    }
    q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

    if (cursor) {
      const cursorSnap = await db.collection('adminNotifications').doc(cursor).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
      }
    }

    const snap = await q.get();
    const entries: AdminNotificationListItem[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        type: data.type,
        category: data.category,
        priority: data.priority,
        title: data.title,
        message: data.message,
        resourceType: (data.resourceType as string) ?? null,
        resourceId: (data.resourceId as string) ?? null,
        actionUrl: data.actionUrl,
        isRead: data.isRead ?? false,
        readAt: data.readAt?.toDate?.().toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      };
    });
    const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

    return {entries, nextCursor};
  },
);
