import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {cascadeVendorStatusToListings} from '../../marketplace/service';
import {createNotification} from '../../notifications/service';
import {requireActiveAdminAny, assertPermission} from './requireActiveAdmin';
import {writeAuditLog, type AdminAuditAction} from './writeAuditLog';
import type {Permission} from './permissions';
import type {ReportTargetType} from '../../reports/service';

const ACTIONS_BY_TARGET: Record<ReportTargetType, string[]> = {
  user: ['user.warn', 'user.suspend'],
  post: ['content.hide', 'content.remove'],
  comment: ['comment.hide'],
  sound: ['sound.hide', 'sound.remove'],
  live: ['live.end'],
  vendor: ['vendor.suspend'],
  listing: ['listing.suspend'],
};

const PERMISSION_BY_ACTION: Record<string, Permission> = {
  'user.warn': 'reports.resolve',
  'user.suspend': 'users.suspend',
  'content.hide': 'content.moderate',
  'content.remove': 'content.delete',
  'comment.hide': 'content.moderate',
  'sound.hide': 'sounds.moderate',
  'sound.remove': 'sounds.moderate',
  'live.end': 'live.end',
  'vendor.suspend': 'marketplace.vendors.manage',
  'listing.suspend': 'marketplace.moderate',
};

interface AdminResolveReportRequest {
  reportId: string;
  actionTaken: string;
  reason: string;
}

interface AdminResolveReportResponse {
  reportId: string;
  status: 'resolved';
  actionTaken: string;
}

/**
 * Takes the moderation action AND resolves the report in one call — never
 * two separate client round-trips, which could leave a report stuck at
 * 'pending' if the second call failed after the first succeeded (Decision
 * 4). Each action below performs the exact same state change + audit +
 * notification its standalone counterpart (hideContent, suspendUser, etc.)
 * does — duplicated inline rather than factored into shared helpers, since
 * refactoring those already-deployed functions carries more risk than the
 * modest duplication saves (same reasoning as Marketplace's per-file
 * verifyUpload). The audit log entry uses the real action's own action
 * string (e.g. 'content.hide'), not a generic 'report.resolve', so
 * Moderation History reads identically regardless of whether the action
 * came from a report or the entity's own admin page.
 *
 * Permission is action-specific (Decision 5): requireActiveAdminAny reads
 * the admin's role first, then assertPermission checks the permission the
 * chosen action actually implies — otherwise a moderator holding only
 * reports.resolve could suspend a user or vendor without holding
 * users.suspend/marketplace.vendors.manage directly, a real privilege gap.
 */
export const adminResolveReport = onCall<AdminResolveReportRequest, Promise<AdminResolveReportResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdminAny(request);

  const reportId = request.data?.reportId;
  const actionTaken = request.data?.actionTaken;
  const reason = request.data?.reason?.trim();
  if (typeof reportId !== 'string' || reportId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing reportId.');
  }
  if (typeof actionTaken !== 'string' || actionTaken.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing action.');
  }
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const reportRef = db.collection('reports').doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    throw new HttpsError('not-found', 'This report could not be found.');
  }
  const report = reportSnap.data()!;
  if (report.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only a pending report can be resolved.');
  }

  const targetType = report.targetType as ReportTargetType;
  if (!ACTIONS_BY_TARGET[targetType]?.includes(actionTaken)) {
    throw new HttpsError('invalid-argument', 'This action is not valid for this report.');
  }
  assertPermission(admin, PERMISSION_BY_ACTION[actionTaken]);

  const targetId = report.targetId as string;
  const postId = (report.context?.postId as string | undefined) ?? undefined;

  switch (actionTaken) {
    case 'user.warn': {
      const userSnap = await db.collection('users').doc(targetId).get();
      if (!userSnap.exists) throw new HttpsError('not-found', 'This user could not be found.');
      await createNotification({recipientId: targetId, actorId: 'system', actorOverride: {displayName: 'Gistoneer'}, type: 'user_warned', reason}).catch(() => {});
      break;
    }
    case 'user.suspend': {
      if (targetId === admin.uid) throw new HttpsError('invalid-argument', "You can't suspend your own account through this tool.");
      const userRef = db.collection('users').doc(targetId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) throw new HttpsError('not-found', 'This user could not be found.');
      try {
        await auth.updateUser(targetId, {disabled: true});
      } catch {
        throw new HttpsError('internal', 'Unable to suspend this user. Please try again.');
      }
      await userRef.update({status: 'suspended', updatedAt: FieldValue.serverTimestamp()});
      await createNotification({recipientId: targetId, actorId: 'system', actorOverride: {displayName: 'Gistoneer'}, type: 'user_suspended', reason}).catch(() => {});
      break;
    }
    case 'content.hide':
    case 'content.remove': {
      const postRef = db.collection('posts').doc(targetId);
      const postSnap = await postRef.get();
      if (!postSnap.exists || postSnap.data()?.status !== 'published') throw new HttpsError('not-found', 'This content could not be found.');
      const moderationStatus = actionTaken === 'content.hide' ? 'hidden' : 'removed';
      await postRef.update({moderationStatus, updatedAt: FieldValue.serverTimestamp()});
      await createNotification({
        recipientId: postSnap.data()!.authorId as string,
        actorId: 'system',
        actorOverride: {displayName: 'Gistoneer'},
        type: actionTaken === 'content.hide' ? 'content_hidden' : 'content_removed',
        postId: targetId,
        reason,
      }).catch(() => {});
      break;
    }
    case 'comment.hide': {
      if (!postId) throw new HttpsError('invalid-argument', 'Missing comment context.');
      const commentRef = db.collection('posts').doc(postId).collection('comments').doc(targetId);
      const commentSnap = await commentRef.get();
      if (!commentSnap.exists) throw new HttpsError('not-found', 'This comment could not be found.');
      await commentRef.update({moderationStatus: 'hidden', updatedAt: FieldValue.serverTimestamp()});
      await createNotification({
        recipientId: commentSnap.data()!.authorId as string,
        actorId: 'system',
        actorOverride: {displayName: 'Gistoneer'},
        type: 'comment_hidden',
        postId,
        commentId: targetId,
        reason,
      }).catch(() => {});
      break;
    }
    case 'sound.hide':
    case 'sound.remove': {
      const soundRef = db.collection('sounds').doc(targetId);
      const soundSnap = await soundRef.get();
      if (!soundSnap.exists) throw new HttpsError('not-found', 'This sound could not be found.');
      const moderationStatus = actionTaken === 'sound.hide' ? 'hidden' : 'removed';
      await soundRef.update({moderationStatus, updatedAt: FieldValue.serverTimestamp()});
      await createNotification({
        recipientId: soundSnap.data()!.ownerId as string,
        actorId: 'system',
        actorOverride: {displayName: 'Gistoneer'},
        type: actionTaken === 'sound.hide' ? 'sound_hidden' : 'sound_removed',
        soundId: targetId,
        reason,
      }).catch(() => {});
      break;
    }
    case 'live.end': {
      const sessionRef = db.collection('liveSessions').doc(targetId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) throw new HttpsError('not-found', 'This live session could not be found.');
      if (sessionSnap.data()?.status !== 'ended') {
        await sessionRef.update({status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
        await createNotification({
          recipientId: sessionSnap.data()!.hostId as string,
          actorId: 'system',
          actorOverride: {displayName: 'Gistoneer'},
          type: 'live_ended_by_admin',
          liveId: targetId,
          reason,
        }).catch(() => {});
      }
      break;
    }
    case 'vendor.suspend': {
      const vendorRef = db.collection('vendors').doc(targetId);
      const vendorSnap = await vendorRef.get();
      if (!vendorSnap.exists) throw new HttpsError('not-found', 'This vendor could not be found.');
      if (vendorSnap.data()?.status !== 'approved') throw new HttpsError('failed-precondition', 'Only an approved vendor can be suspended.');
      await vendorRef.update({status: 'suspended', updatedAt: FieldValue.serverTimestamp()});
      await cascadeVendorStatusToListings(targetId, 'suspended');
      break;
    }
    case 'listing.suspend': {
      const listingRef = db.collection('listings').doc(targetId);
      const listingSnap = await listingRef.get();
      if (!listingSnap.exists) throw new HttpsError('not-found', 'This listing could not be found.');
      if (listingSnap.data()?.status !== 'published') throw new HttpsError('failed-precondition', 'Only a published listing can be suspended.');
      await listingRef.update({status: 'suspended', moderationReason: reason, updatedAt: FieldValue.serverTimestamp()});
      await createNotification({
        recipientId: listingSnap.data()!.vendorId as string,
        actorId: 'system',
        actorOverride: {displayName: 'Gistoneer'},
        type: 'listing_suspended',
        reason,
        listingId: targetId,
      }).catch(() => {});
      break;
    }
  }

  await reportRef.update({
    status: 'resolved',
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: admin.email,
    resolution: reason,
    actionTaken,
  });

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: actionTaken as AdminAuditAction,
    targetType: targetType === 'comment' ? 'comment' : targetType === 'sound' ? 'sound' : targetType === 'live' ? 'live' : targetType === 'vendor' ? 'vendor' : targetType === 'listing' ? 'listing' : targetType === 'user' ? 'user' : 'content',
    targetId,
    reason,
  }).catch(() => {});

  return {reportId, status: 'resolved', actionTaken};
});
