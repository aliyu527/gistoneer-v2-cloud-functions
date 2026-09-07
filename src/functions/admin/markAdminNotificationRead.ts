import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdminAny} from './requireActiveAdmin';

interface MarkAdminNotificationReadRequest {
  notificationId: string;
}

interface MarkAdminNotificationReadResponse {
  updated: true;
}

/**
 * Explicit IDOR check required here: Firestore rules deny all client access
 * to adminNotifications (allow read, write: if false), so this callable is
 * the ONLY path to this data — it must independently verify the doc's
 * recipientId matches the caller before mutating, exactly as if a client
 * rule existed. Idempotent: calling twice on an already-read notification
 * is a harmless no-op re-write of the same isRead:true state.
 */
export const markAdminNotificationRead = onCall<MarkAdminNotificationReadRequest, Promise<MarkAdminNotificationReadResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdminAny(request);

    const notificationId = request.data?.notificationId;
    if (typeof notificationId !== 'string' || notificationId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing notificationId.');
    }

    const ref = db.collection('adminNotifications').doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Notification not found.');
    }
    if (snap.data()?.recipientId !== admin.uid) {
      throw new HttpsError('permission-denied', 'Not authorized.');
    }

    await ref.update({isRead: true, readAt: FieldValue.serverTimestamp()});

    return {updated: true};
  },
);
