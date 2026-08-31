import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';

interface MarkNotificationReadRequest {
  notificationId: string;
}

export const markNotificationRead = onCall<MarkNotificationReadRequest, Promise<{read: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {notificationId} = request.data ?? {};
    if (typeof notificationId !== 'string' || notificationId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing notification reference.');
    }

    const ref = db.collection('notifications').doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', "We couldn't find that notification.");
    }
    if (snap.data()!.recipientId !== request.auth.uid) {
      // Same "not-found" wording as other owner-only lookups in this app —
      // don't reveal that a notification exists but belongs to someone else.
      throw new HttpsError('not-found', "We couldn't find that notification.");
    }

    await ref.update({isRead: true, readAt: FieldValue.serverTimestamp()});
    return {read: true};
  },
);
