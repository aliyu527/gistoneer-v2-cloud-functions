import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdminAny} from './requireActiveAdmin';

interface GetUnreadAdminNotificationCountResponse {
  count: number;
}

/** The bell-poll endpoint — a real count() aggregation, never a full-collection download. */
export const getUnreadAdminNotificationCount = onCall<undefined, Promise<GetUnreadAdminNotificationCountResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    const admin = await requireActiveAdminAny(request);

    const snap = await db.collection('adminNotifications').where('recipientId', '==', admin.uid).where('isRead', '==', false).count().get();

    return {count: snap.data().count};
  },
);
