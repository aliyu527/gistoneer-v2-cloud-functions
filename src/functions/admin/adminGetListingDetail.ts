import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminListingListItem, AdminListingStatus} from './adminListListings';

export interface AdminListingDetail extends Omit<AdminListingListItem, 'media'> {
  description: string;
  media: {url: string; thumbnailUrl?: string; width?: number; height?: number}[];
  location: {name: string} | null;
  currency: string | null;
  condition: string | null;
  quantity: number | null;
  pricingModel: string | null;
  rate: number | null;
  skills: string[];
  moderationReason: string | null;
  updatedAt: string | null;
  vendorUsername: string | null;
  vendorStatus: string | null;
  lastModeration: {action: 'listing.suspend' | 'listing.restore'; reason: string | null; at: string | null; byEmail: string | null} | null;
}

interface AdminGetListingDetailRequest {
  listingId: string;
}

export const adminGetListingDetail = onCall<AdminGetListingDetailRequest, Promise<AdminListingDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'marketplace.read');

  const listingId = request.data?.listingId;
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing listingId.');
  }

  const snap = await db.collection('listings').doc(listingId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This listing could not be found.');
  }
  const data = snap.data()!;
  const status = (data.status as AdminListingStatus) ?? 'draft';
  const vendorId = (data.vendorId as string) ?? '';

  const [userSnap, lastModerationSnap] = await Promise.all([
    db.collection('users').doc(vendorId).get(),
    status === 'suspended'
      ? db.collection('adminAuditLogs').where('targetId', '==', listingId).where('targetType', '==', 'listing').orderBy('createdAt', 'desc').limit(1).get()
      : Promise.resolve(null),
  ]);

  let lastModeration: AdminListingDetail['lastModeration'] = null;
  if (lastModerationSnap && !lastModerationSnap.empty) {
    const entry = lastModerationSnap.docs[0].data();
    lastModeration = {
      action: entry.action as 'listing.suspend' | 'listing.restore',
      reason: (entry.reason as string) ?? null,
      at: entry.createdAt?.toDate?.().toISOString() ?? null,
      byEmail: (entry.actorEmail as string) ?? null,
    };
  }

  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];

  return {
    id: snap.id,
    vendorId,
    vendorShopName: (data.vendorShopName as string) ?? null,
    vendorUsername: (userSnap.data()?.username as string) ?? null,
    vendorStatus: (data.vendorStatus as string) ?? null,
    type: (data.type as AdminListingDetail['type']) ?? 'product',
    title: (data.title as string) ?? '',
    description: (data.description as string) ?? '',
    category: (data.category as string) ?? '',
    status,
    media: media.map((item) => ({
      url: (item.url as string) ?? '',
      thumbnailUrl: item.thumbnailUrl as string | undefined,
      width: item.width as number | undefined,
      height: item.height as number | undefined,
    })),
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    price: typeof data.price === 'number' ? data.price : null,
    currency: (data.currency as string) ?? null,
    condition: (data.condition as string) ?? null,
    quantity: typeof data.quantity === 'number' ? data.quantity : null,
    pricingModel: (data.pricingModel as string) ?? null,
    rate: typeof data.rate === 'number' ? data.rate : null,
    skills: Array.isArray(data.skills) ? (data.skills as string[]) : [],
    moderationReason: (data.moderationReason as string) ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    lastModeration,
  };
});
