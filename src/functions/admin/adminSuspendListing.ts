import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {createNotification} from '../../notifications/service';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminSuspendListingRequest {
  listingId: string;
  reason: string;
}

interface AdminSuspendListingResponse {
  listingId: string;
  status: 'suspended';
}

/** Only a currently 'published' listing can be suspended (a draft/archived listing isn't publicly visible anyway; a listing owned by an already-suspended vendor is redundant to suspend individually). Single permission tier, matching sounds' exact pattern — no separate delete permission exists or is needed here either. */
export const adminSuspendListing = onCall<AdminSuspendListingRequest, Promise<AdminSuspendListingResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.moderate');

  const listingId = request.data?.listingId;
  const reason = request.data?.reason?.trim();
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing listingId.');
  }
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A reason is required.');
  }

  const ref = db.collection('listings').doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }
  const listing = snap.data()!;
  if (listing.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Only a published listing can be suspended.');
  }

  await ref.update({status: 'suspended', moderationReason: reason, updatedAt: FieldValue.serverTimestamp()});

  await createNotification({
    recipientId: listing.vendorId as string,
    actorId: 'system',
    actorOverride: {displayName: 'Gistoneer'},
    type: 'listing_suspended',
    reason,
    listingId,
  }).catch(() => {});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'listing.suspend',
    targetType: 'listing',
    targetId: listingId,
    reason,
  }).catch(() => {});

  return {listingId, status: 'suspended'};
});
