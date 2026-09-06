import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {isValidCategory, verifyUpload} from '../../marketplace/service';

const MAX_SHOP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_NAME_LENGTH = 100;
const MAX_CATEGORIES = 5;

interface UpdateShopRequest {
  shopName?: string;
  description?: string;
  location?: {name?: string};
  contactEmail?: string;
  contactPhone?: string;
  categories?: string[];
  logoUploadId?: string;
  coverUploadId?: string;
}

interface UpdateShopResponse {
  updated: true;
}

/** Owner-only, requires an already-approved vendor. Never touches `status` — approval/suspension are admin-only transitions. */
export const updateShop = onCall<UpdateShopRequest, Promise<UpdateShopResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;
  const data = request.data ?? ({} as UpdateShopRequest);

  const vendorRef = db.collection('vendors').doc(uid);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists || vendorSnap.data()?.status !== 'approved') {
    throw new HttpsError('failed-precondition', 'You need an approved vendor account to manage a shop.');
  }

  const updates: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp()};

  if (data.shopName !== undefined) {
    const shopName = data.shopName.trim();
    if (shopName.length === 0 || shopName.length > MAX_SHOP_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', `Shop name must be ${MAX_SHOP_NAME_LENGTH} characters or fewer.`);
    }
    updates.shopName = shopName;
  }
  if (data.description !== undefined) {
    const description = data.description.trim();
    if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
      throw new HttpsError('invalid-argument', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }
    updates.description = description;
  }
  if (data.location?.name !== undefined) {
    const locationName = data.location.name.trim();
    if (locationName.length === 0 || locationName.length > MAX_LOCATION_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', 'Invalid location.');
    }
    updates.location = {name: locationName};
  }
  if (data.contactEmail !== undefined) {
    updates.contactEmail = data.contactEmail.trim().slice(0, 200) || FieldValue.delete();
  }
  if (data.contactPhone !== undefined) {
    updates.contactPhone = data.contactPhone.trim().slice(0, 30) || FieldValue.delete();
  }
  if (data.categories !== undefined) {
    const categories = [...new Set(data.categories)].filter(isValidCategory);
    if (categories.length === 0 || categories.length > MAX_CATEGORIES) {
      throw new HttpsError('invalid-argument', `Choose between 1 and ${MAX_CATEGORIES} categories.`);
    }
    updates.categories = categories;
  }
  if (data.logoUploadId) {
    const upload = await verifyUpload(data.logoUploadId, uid);
    if (!upload || upload.mediaType !== 'image') {
      throw new HttpsError('failed-precondition', "Your shop logo hasn't finished uploading. Please try again.");
    }
    updates.logoUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
    updates.logoStorageKey = upload.storageKey;
  }
  if (data.coverUploadId) {
    const upload = await verifyUpload(data.coverUploadId, uid);
    if (!upload || upload.mediaType !== 'image') {
      throw new HttpsError('failed-precondition', "Your cover image hasn't finished uploading. Please try again.");
    }
    updates.coverUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
    updates.coverStorageKey = upload.storageKey;
  }

  await vendorRef.update(updates);
  return {updated: true};
});
