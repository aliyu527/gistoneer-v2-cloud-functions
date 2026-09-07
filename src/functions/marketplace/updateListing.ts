import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {buildPublicUrl} from '../../lib/s3';
import {isValidCategory, verifyUpload} from '../../marketplace/service';
import {enforceRateLimit} from '../../lib/rateLimit';

const CONDITIONS = ['new', 'used'] as const;
const PRICING_MODELS = ['fixed', 'hourly', 'starting_at', 'negotiable', 'contact_for_quote'] as const;
type PricingModel = (typeof PRICING_MODELS)[number];
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_MEDIA_ITEMS = 6;
const MAX_SKILLS = 10;

/** Owner-controlled transitions only — never into/out of 'suspended', which is admin-only. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'archived'],
  published: ['archived'],
};

interface UpdateListingMediaInput {
  uploadId: string;
  thumbnailUploadId?: string;
  width?: number;
  height?: number;
}

interface UpdateListingRequest {
  listingId?: string;
  title?: string;
  description?: string;
  category?: string;
  media?: UpdateListingMediaInput[];
  location?: {name?: string};
  status?: 'draft' | 'published' | 'archived';
  price?: number;
  condition?: 'new' | 'used';
  quantity?: number;
  pricingModel?: PricingModel;
  rate?: number;
  skills?: string[];
}

interface UpdateListingResponse {
  updated: true;
}

export const updateListing = onCall<UpdateListingRequest, Promise<UpdateListingResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  }
  const uid = request.auth.uid;
  await enforceRateLimit(uid, 'updateListing', {maxPerWindow: 20, windowMs: 10 * 60 * 1000});
  const data = request.data ?? ({} as UpdateListingRequest);

  const listingId = data.listingId;
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing listingId.');
  }

  const ref = db.collection('listings').doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }
  const listing = snap.data()!;
  if (listing.vendorId !== uid) {
    throw new HttpsError('permission-denied', "This isn't your listing.");
  }
  if (listing.status === 'suspended') {
    throw new HttpsError('failed-precondition', 'This listing is suspended and cannot be edited.');
  }

  const updates: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp()};

  if (data.status !== undefined) {
    const allowed = ALLOWED_TRANSITIONS[listing.status] ?? [];
    if (!allowed.includes(data.status)) {
      throw new HttpsError('invalid-argument', `Cannot change status from ${listing.status} to ${data.status}.`);
    }
    updates.status = data.status;
    if (data.status === 'published' && !listing.publishedAt) {
      updates.publishedAt = FieldValue.serverTimestamp();
    }
  }

  if (data.title !== undefined) {
    const title = data.title.trim();
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
      throw new HttpsError('invalid-argument', `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
    }
    updates.title = title;
  }
  if (data.description !== undefined) {
    const description = data.description.trim();
    if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
      throw new HttpsError('invalid-argument', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }
    updates.description = description;
  }
  if (data.category !== undefined) {
    if (!isValidCategory(data.category)) {
      throw new HttpsError('invalid-argument', 'Invalid category.');
    }
    updates.category = data.category;
  }
  if (data.location !== undefined) {
    const locationName = (data.location.name ?? '').trim();
    updates.location = locationName ? {name: locationName} : FieldValue.delete();
  }

  if (Array.isArray(data.media)) {
    if (data.media.length === 0) {
      throw new HttpsError('invalid-argument', 'Add at least one photo.');
    }
    if (data.media.length > MAX_MEDIA_ITEMS) {
      throw new HttpsError('invalid-argument', `Listings can include at most ${MAX_MEDIA_ITEMS} images.`);
    }
    const media = [];
    for (const item of data.media) {
      if (!item?.uploadId) {
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
    updates.media = media;
  }

  if (listing.type === 'product') {
    if (data.price !== undefined) {
      if (typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price < 0) {
        throw new HttpsError('invalid-argument', 'Enter a valid price.');
      }
      updates.price = data.price;
    }
    if (data.condition !== undefined) {
      updates.condition = CONDITIONS.includes(data.condition) ? data.condition : FieldValue.delete();
    }
    if (data.quantity !== undefined) {
      updates.quantity = Number.isFinite(data.quantity) && data.quantity >= 0 ? Math.floor(data.quantity) : FieldValue.delete();
    }
  } else {
    if (data.pricingModel !== undefined) {
      if (!PRICING_MODELS.includes(data.pricingModel)) {
        throw new HttpsError('invalid-argument', 'Invalid pricing model.');
      }
      updates.pricingModel = data.pricingModel;
      if (['fixed', 'hourly', 'starting_at'].includes(data.pricingModel)) {
        if (typeof data.rate !== 'number' || !Number.isFinite(data.rate) || data.rate < 0) {
          throw new HttpsError('invalid-argument', 'Enter a valid rate.');
        }
        updates.rate = data.rate;
        updates.currency = 'NGN';
      } else {
        updates.rate = FieldValue.delete();
      }
    }
    if (data.skills !== undefined) {
      const skills = [...new Set(data.skills.map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SKILLS);
      updates.skills = skills.length > 0 ? skills : FieldValue.delete();
    }
  }

  await ref.update(updates);
  return {updated: true};
});
