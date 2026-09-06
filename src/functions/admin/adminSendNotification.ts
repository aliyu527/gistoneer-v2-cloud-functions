import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

type AudienceType = 'all' | 'active' | 'user';

interface AdminSendNotificationRequest {
  title: string;
  body: string;
  audienceType: AudienceType;
  targetUserId?: string;
}

interface AdminSendNotificationResponse {
  campaignId: string;
  recipientCount: number;
  failureCount: number;
}

const TITLE_MAX_LENGTH = 100;
const BODY_MAX_LENGTH = 500;
const AUDIENCE_PAGE_SIZE = 1000;

/**
 * Resolves every uid in `users` via cursor pagination — never a single
 * unbounded query. Held in memory for this app's current scale, per the
 * plan's disclosed "not a distributed job system" tradeoff. The 'active'
 * filter happens per-page, client-side, not via a where() clause: every
 * existing user doc predates the `status` field (Module 04), so "missing or
 * active" isn't expressible as a single Firestore equality filter — a
 * missing value defaults to 'active', same default used everywhere else
 * this field is read.
 */
async function resolveAudienceUids(audienceType: 'all' | 'active'): Promise<string[]> {
  const uids: string[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(AUDIENCE_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      if (audienceType === 'active') {
        const status = (doc.data().status as string) ?? 'active';
        if (status !== 'active') continue;
      }
      uids.push(doc.id);
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < AUDIENCE_PAGE_SIZE) break;
  }
  return uids;
}

/**
 * The one real "send to many" admin action. Uses Firestore's BulkWriter
 * (not a Promise.all loop) — the correct tool for writing potentially the
 * entire user base efficiently, with built-in batching/rate-limiting/retry.
 * Longer timeout (see index.ts registration) is the one deliberate exception
 * to "no timeout overrides" in this admin function family, justified by a
 * genuinely long-running full-audience resolve+write.
 */
export const adminSendNotification = onCall<AdminSendNotificationRequest, Promise<AdminSendNotificationResponse>>(
  {cors: true, region: 'us-central1', timeoutSeconds: 300},
  async (request) => {
    const admin = await requireActiveAdmin(request, 'notifications.send');

    const title = request.data?.title?.trim();
    const body = request.data?.body?.trim();
    const audienceType = request.data?.audienceType;
    const targetUserId = request.data?.targetUserId;

    if (!title || title.length === 0 || title.length > TITLE_MAX_LENGTH) {
      throw new HttpsError('invalid-argument', `Title is required and must be ${TITLE_MAX_LENGTH} characters or fewer.`);
    }
    if (!body || body.length === 0 || body.length > BODY_MAX_LENGTH) {
      throw new HttpsError('invalid-argument', `Message is required and must be ${BODY_MAX_LENGTH} characters or fewer.`);
    }
    if (audienceType !== 'all' && audienceType !== 'active' && audienceType !== 'user') {
      throw new HttpsError('invalid-argument', 'Invalid audience.');
    }
    if (audienceType === 'user') {
      if (typeof targetUserId !== 'string' || targetUserId.length === 0) {
        throw new HttpsError('invalid-argument', 'Missing target user.');
      }
      const targetSnap = await db.collection('users').doc(targetUserId).get();
      if (!targetSnap.exists) {
        throw new HttpsError('not-found', 'This user could not be found.');
      }
    }

    const uids = audienceType === 'user' ? [targetUserId as string] : await resolveAudienceUids(audienceType);

    const campaignId = db.collection('adminAuditLogs').doc().id;

    let successCount = 0;
    let failureCount = 0;
    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
      failureCount += 1;
      return error.failedAttempts < 3;
    });
    bulkWriter.onWriteResult(() => {
      successCount += 1;
    });

    for (const uid of uids) {
      const ref = db.collection('notifications').doc(`${uid}_announcement_${campaignId}`);
      bulkWriter.set(
        ref,
        {
          recipientId: uid,
          actorId: 'system',
          actor: {displayName: 'Gistoneer'},
          type: 'announcement',
          title,
          body,
          isRead: false,
          createdAt: FieldValue.serverTimestamp(),
        },
        {merge: true},
      );
    }
    await bulkWriter.close();

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'notification.send',
      targetType: 'notification',
      targetId: campaignId,
      reason: null,
      docId: campaignId,
      metadata: {
        title,
        body,
        audienceType,
        targetUserId: audienceType === 'user' ? targetUserId : null,
        recipientCount: successCount,
        failureCount,
      },
    }).catch(() => {});

    return {campaignId, recipientCount: successCount, failureCount};
  },
);
