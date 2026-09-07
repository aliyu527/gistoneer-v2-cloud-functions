import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {isValidCategory, verifyUpload} from '../../marketplace/service';
import {getPlatformSettings} from '../../lib/platformSettings';

const LISTING_TYPES = ['product', 'service'] as const;
type ListingType = (typeof LISTING_TYPES)[number];
const CONDITIONS = ['new', 'used'] as const;
const PRICING_MODELS = ['fixed', 'hourly', 'starting_at', 'negotiable', 'contact_for_quote'] as const;
type PricingModel = (typeof PRICING_MODELS)[number];
const DRAFT_STATUSES = ['draft', 'published'] as const;

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_MEDIA_ITEMS = 6;
const MAX_LOCATION_NAME_LENGTH = 100;
const MAX_SKILLS = 10;

interface CreateListingMediaInput {
  uploadId: string;
  thumbnailUploadId?: string;
  width?: number;
  height?: number;
}

interface CreateListingRequest {
  type?: ListingType;
  title?: string;
  description?: string;
  category?: string;
  media?: CreateListingMediaInput[];
  location?: {name?: string};
  status?: 'draft' | 'published';
  // product
  price?: number;
  condition?: 'new' | 'used';
  quantity?: number;
  // service
  pricingModel?: PricingModel;
  rate?: number;
  skills?: string[];
}

interface CreateListingResponse {
  listingId: string;
}

interface ListingMedia {
  url: string;
  thumbnailUrl?: string;
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * Requires an 'approved' vendor (never trusts a client-claimed vendor
 * status). Denormalizes vendorStatus/vendorShopName/vendorLogoUrl from the
 * caller's OWN vendors/{uid} doc at write time — never accepts these as
 * client input — mirroring posts.author's exact denormalization posture.
 */
export const createListing = onCall<CreateListingRequest, Promise<CreateListingResponse>>({cors: true, region: 'us-central1'}, async (request) => {
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
  const data = request.data ?? ({} as CreateListingRequest);

  const vendorSnap = await db.collection('vendors').doc(uid).get();
  const vendor = vendorSnap.data();
  if (!vendorSnap.exists || vendor?.status !== 'approved') {
    throw new HttpsError('failed-precondition', 'You need an approved vendor account to create a listing.');
  }

  if (!data.type || !LISTING_TYPES.includes(data.type)) {
    throw new HttpsError('invalid-argument', 'Invalid listing type.');
  }
  const title = (data.title ?? '').trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new HttpsError('invalid-argument', `Title is required and must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  const description = (data.description ?? '').trim();
  if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpsError('invalid-argument', `Description is required and must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  if (!isValidCategory(data.category)) {
    throw new HttpsError('invalid-argument', 'Invalid category.');
  }
  if (!data.status || !DRAFT_STATUSES.includes(data.status)) {
    throw new HttpsError('invalid-argument', 'Invalid status.');
  }

  if (!Array.isArray(data.media) || data.media.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one photo.');
  }
  if (data.media.length > MAX_MEDIA_ITEMS) {
    throw new HttpsError('invalid-argument', `Listings can include at most ${MAX_MEDIA_ITEMS} images.`);
  }
  const media: ListingMedia[] = [];
  for (const item of data.media) {
    if (!item?.uploadId || typeof item.uploadId !== 'string') {
      throw new HttpsError('invalid-argument', 'One of your images is missing.');
    }
    const upload = await verifyUpload(item.uploadId, uid);
    if (!upload || upload.mediaType !== 'image') {
      throw new HttpsError('failed-precondition', "One of your images hasn't finished uploading. Please try again.");
    }
    let thumbnailUrl: string | undefined;
    if (item.thumbnailUploadId) {
      const thumbUpload = await verifyUpload(item.thumbnailUploadId, uid);
      if (thumbUpload) thumbnailUrl = buildPublicUrl(thumbUpload.storageKey, thumbUpload.bucket, thumbUpload.region);
    }
    media.push({
      url: buildPublicUrl(upload.storageKey, upload.bucket, upload.region),
      ...(thumbnailUrl ? {thumbnailUrl} : {}),
      storageKey: upload.storageKey,
      mimeType: upload.mimeType,
      ...(item.width ? {width: item.width} : {}),
      ...(item.height ? {height: item.height} : {}),
    });
  }

  let locationField: {name: string} | undefined;
  if (data.location?.name) {
    const locationName = data.location.name.trim();
    if (locationName.length > MAX_LOCATION_NAME_LENGTH) {
      throw new HttpsError('invalid-argument', 'Location name is too long.');
    }
    if (locationName.length > 0) locationField = {name: locationName};
  }

  const typeFields: Record<string, unknown> = {};
  if (data.type === 'product') {
    if (typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price < 0) {
      throw new HttpsError('invalid-argument', 'Enter a valid price.');
    }
    typeFields.price = data.price;
    typeFields.currency = 'NGN';
    if (data.condition && CONDITIONS.includes(data.condition)) typeFields.condition = data.condition;
    if (typeof data.quantity === 'number' && Number.isFinite(data.quantity) && data.quantity >= 0) {
      typeFields.quantity = Math.floor(data.quantity);
    }
  } else {
    if (!data.pricingModel || !PRICING_MODELS.includes(data.pricingModel)) {
      throw new HttpsError('invalid-argument', 'Choose a pricing model.');
    }
    typeFields.pricingModel = data.pricingModel;
    if (['fixed', 'hourly', 'starting_at'].includes(data.pricingModel)) {
      if (typeof data.rate !== 'number' || !Number.isFinite(data.rate) || data.rate < 0) {
        throw new HttpsError('invalid-argument', 'Enter a valid rate.');
      }
      typeFields.rate = data.rate;
      typeFields.currency = 'NGN';
    }
    if (Array.isArray(data.skills)) {
      const skills = [...new Set(data.skills.map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SKILLS);
      if (skills.length > 0) typeFields.skills = skills;
    }
  }

  const ref = db.collection('listings').doc();
  await ref.set({
    id: ref.id,
    vendorId: uid,
    vendorStatus: vendor.status,
    vendorShopName: vendor.shopName ?? null,
    vendorLogoUrl: vendor.logoUrl ?? null,
    type: data.type,
    title,
    description,
    category: data.category,
    media,
    ...(locationField ? {location: locationField} : {}),
    status: data.status,
    ...typeFields,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(data.status === 'published' ? {publishedAt: FieldValue.serverTimestamp()} : {}),
  });

  return {listingId: ref.id};
});
