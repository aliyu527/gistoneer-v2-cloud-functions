import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

interface AdminRestoreListingRequest {
  listingId: string;
}

interface AdminRestoreListingResponse {
  listingId: string;
  status: 'published';
}

export const adminRestoreListing = onCall<AdminRestoreListingRequest, Promise<AdminRestoreListingResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'marketplace.moderate');

  const listingId = request.data?.listingId;
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing listingId.');
  }

  const ref = db.collection('listings').doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }
  if (snap.data()?.status !== 'suspended') {
    throw new HttpsError('failed-precondition', 'Only a suspended listing can be restored.');
  }

  await ref.update({status: 'published', moderationReason: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp()});

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'listing.restore',
    targetType: 'listing',
    targetId: listingId,
    reason: null,
  }).catch(() => {});

  return {listingId, status: 'published'};
});
