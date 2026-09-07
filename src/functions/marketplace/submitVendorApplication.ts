import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {isValidCategory, verifyUpload} from '../../marketplace/service';
import {getPlatformSettings} from '../../lib/platformSettings';

const BUSINESS_TYPES = ['individual', 'registered_business'] as const;
type BusinessType = (typeof BUSINESS_TYPES)[number];

const MAX_SHOP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_NAME_LENGTH = 100;
const MAX_CATEGORIES = 5;

interface SubmitVendorApplicationRequest {
  shopName?: string;
  description?: string;
  businessType?: BusinessType;
  location?: {name?: string};
  contactEmail?: string;
  contactPhone?: string;
  categories?: string[];
  logoUploadId?: string;
  coverUploadId?: string;
}

interface SubmitVendorApplicationResponse {
  status: 'pending';
}

/**
 * Creates/overwrites vendors/{uid} with status:'pending'. Modeled on
 * admins/{uid}'s own "one doc, evolving status" shape — a vendor's approved
 * record IS their shop profile, not a separate collection. Allowed to
 * (re)submit only when there's no existing application or the last one was
 * 'rejected'; blocked while 'pending'/'approved' (already in progress or
 * done) and while 'suspended' (that requires admin restore, not self-serve
 * reapplication).
 */
export const submitVendorApplication = onCall<SubmitVendorApplicationRequest, Promise<SubmitVendorApplicationResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }

    const settings = await getPlatformSettings();
    if (settings.maintenanceMode.enabled) {
      throw new HttpsError('failed-precondition', settings.maintenanceMode.message || 'Gistoneer is under maintenance. Please try again shortly.');
    }
    if (!settings.marketplaceEnabled) {
      throw new HttpsError('failed-precondition', 'Marketplace is temporarily disabled. Please try again later.');
    }

    const uid = request.auth.uid;
    const data = request.data ?? ({} as SubmitVendorApplicationRequest);

    const existing = await db.collection('vendors').doc(uid).get();
    if (existing.exists) {
      const status = existing.data()?.status;
      if (status === 'pending' || status === 'approved') {
        throw new HttpsError('failed-precondition', 'You already have a vendor application on file.');
      }
      if (status === 'suspended') {
        throw new HttpsError('failed-precondition', 'Your vendor account is suspended. Contact support to restore it.');
      }
    }

    const shopName = (data.shopName ?? '').trim();
    if (shopName.length === 0 || shopName.length > MAX_SHOP_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', `Shop name is required and must be ${MAX_SHOP_NAME_LENGTH} characters or fewer.`);
    }
    const description = (data.description ?? '').trim();
    if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
      throw new HttpsError('invalid-argument', `Description is required and must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }
    const businessType = data.businessType && BUSINESS_TYPES.includes(data.businessType) ? data.businessType : undefined;

    const locationName = (data.location?.name ?? '').trim();
    if (locationName.length === 0 || locationName.length > MAX_LOCATION_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', 'Location is required.');
    }

    const categories = Array.isArray(data.categories) ? [...new Set(data.categories)].filter(isValidCategory) : [];
    if (categories.length === 0 || categories.length > MAX_CATEGORIES) {
      throw new HttpsError('invalid-argument', `Choose between 1 and ${MAX_CATEGORIES} categories.`);
    }

    const contactEmail = typeof data.contactEmail === 'string' ? data.contactEmail.trim().slice(0, 200) || undefined : undefined;
    const contactPhone = typeof data.contactPhone === 'string' ? data.contactPhone.trim().slice(0, 30) || undefined : undefined;

    let logoUrl: string | undefined;
    let logoStorageKey: string | undefined;
    if (data.logoUploadId) {
      const upload = await verifyUpload(data.logoUploadId, uid);
      if (!upload || upload.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "Your shop logo hasn't finished uploading. Please try again.");
      }
      logoUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
      logoStorageKey = upload.storageKey;
    }

    let coverUrl: string | undefined;
    let coverStorageKey: string | undefined;
    if (data.coverUploadId) {
      const upload = await verifyUpload(data.coverUploadId, uid);
      if (!upload || upload.mediaType !== 'image') {
        throw new HttpsError('failed-precondition', "Your cover image hasn't finished uploading. Please try again.");
      }
      coverUrl = buildPublicUrl(upload.storageKey, upload.bucket, upload.region);
      coverStorageKey = upload.storageKey;
    }

    await db.collection('vendors').doc(uid).set(
      {
        uid,
        status: 'pending',
        shopName,
        description,
        ...(businessType ? {businessType} : {}),
        location: {name: locationName},
        ...(contactEmail ? {contactEmail} : {}),
        ...(contactPhone ? {contactPhone} : {}),
        categories,
        ...(logoUrl ? {logoUrl, logoStorageKey} : {}),
        ...(coverUrl ? {coverUrl, coverStorageKey} : {}),
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
        reviewedAt: FieldValue.delete(),
        reviewedBy: FieldValue.delete(),
        rejectionReason: FieldValue.delete(),
      },
      {merge: true},
    );

    return {status: 'pending'};
  },
);
