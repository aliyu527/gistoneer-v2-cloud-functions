import {onSchedule} from 'firebase-functions/v2/scheduler';
import {Timestamp} from 'firebase-admin/firestore';
import {logger} from 'firebase-functions';
import {auth, db} from '../../admin';

/**
 * Hard-deletes accounts whose 30-day grace period (api-es6
 * accountLifecycleService.requestAccountDeletion) has passed without the
 * user logging back in — logging back in during the window is what clears
 * status:'pending_deletion' (see mobile's PendingDeletionGuard +
 * accountLifecycleService.cancelAccountDeletion), so anything still
 * pending here genuinely wasn't reclaimed in time.
 *
 * The first scheduled/cron function in this codebase (confirmed — no
 * onSchedule/pubsub.schedule precedent existed anywhere before this).
 * Deploying it and confirming it actually fires is a manual follow-up
 * (`firebase deploy --only functions:purgeScheduledDeletions`) — this
 * session never performed a Cloud Functions deploy, so that can't be
 * verified here.
 *
 * Requires the users(status ASC, scheduledDeletionAt ASC) composite index
 * already added to firestore.indexes.json.
 */
export const purgeScheduledDeletions = onSchedule('every 24 hours', async () => {
  const now = Timestamp.now();
  const snap = await db.collection('users').where('status', '==', 'pending_deletion').where('scheduledDeletionAt', '<=', now).get();

  if (snap.empty) return;

  let purged = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      // Already gone from Auth (e.g. a previous run partially completed) —
      // still proceed to remove the Firestore doc below rather than
      // leaving an orphaned record stuck in this query forever.
      logger.warn('purgeScheduledDeletions: auth.deleteUser failed, continuing', {uid, error: (error as Error).message});
    }
    await doc.ref.delete();
    purged++;
  }

  logger.info('purgeScheduledDeletions: purged accounts past their grace period', {purged});
});
