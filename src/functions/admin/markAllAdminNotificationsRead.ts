import {onCall} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdminAny} from './requireActiveAdmin';

interface MarkAllAdminNotificationsReadResponse {
  updated: number;
}

/** Affects only the caller's own unread notifications — recipientId == caller's uid is the query filter itself, so there's no way to reach another admin's inbox. */
export const markAllAdminNotificationsRead = onCall<undefined, Promise<MarkAllAdminNotificationsReadResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdminAny(request);

    const snap = await db.collection('adminNotifications').where('recipientId', '==', admin.uid).where('isRead', '==', false).get();
    if (snap.empty) {
      return {updated: 0};
    }

    const batch = db.batch();
    const readAt = FieldValue.serverTimestamp();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {isRead: true, readAt});
    }
    await batch.commit();

    return {updated: snap.docs.length};
  },
);
