import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {verifyUpload} from '../../marketplace/service';
import {requireActiveAdminAny} from './requireActiveAdmin';

const MAX_DISPLAY_NAME_LENGTH = 60;

interface UpdateMyAdminProfileRequest {
  displayName?: string;
  uploadId?: string;
}

interface UpdateMyAdminProfileResponse {
  displayName: string | null;
  photoURL: string | null;
}

/**
 * Self-scoped by construction — writes only to the caller's own users/{uid}
 * doc, only the exact {displayName, photoURL, updatedAt} field set the
 * existing Firestore rule already permits a client to write directly
 * (firestore.rules:12-23). This callable isn't more permissive than that
 * rule — it adds server-side validation (length cap, verified upload
 * ownership) the bare rule can't express. No audit entry: profile cosmetics
 * aren't a security/administrative action, matching the precedent of not
 * auditing notification read-state changes.
 */
export const updateMyAdminProfile = onCall<UpdateMyAdminProfileRequest, Promise<UpdateMyAdminProfileResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdminAny(request);
  const data = request.data ?? {};

  const update: Record<string, unknown> = {};

  if (data.displayName !== undefined) {
    const displayName = data.displayName.trim();
    if (displayName.length === 0 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', `Display name must be between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters.`);
    }
    update.displayName = displayName;
  }

  if (data.uploadId) {
    const upload = await verifyUpload(data.uploadId, admin.uid);
    if (!upload || upload.mediaType !== 'image') {
      throw new HttpsError('failed-precondition', "Your photo hasn't finished uploading. Please try again.");
    }
    update.photoURL = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
  }

  if (Object.keys(update).length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to update.');
  }

  update.updatedAt = FieldValue.serverTimestamp();
  await db.collection('users').doc(admin.uid).set(update, {merge: true});

  const snap = await db.collection('users').doc(admin.uid).get();
  const userData = snap.data();

  return {
    displayName: (userData?.displayName as string) ?? null,
    photoURL: (userData?.photoURL as string) ?? null,
  };
});
