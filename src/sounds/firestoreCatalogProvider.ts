import type {QueryDocumentSnapshot, DocumentData, Query} from 'firebase-admin/firestore';
import {db} from '../admin';
import type {GistoneerSound, Page, PageParams, SoundCategory, SoundProviderAdapter} from './types';

/**
 * The real catalog — admin-curated tracks only (source == 'admin_upload'),
 * distinct from "Community Sounds" (any public user upload), which the
 * mobile Sound Discovery screen already surfaces separately via
 * getPublicSounds. Keeping this provider scoped to admin-curated content
 * avoids the two surfaces overlapping/duplicating each other.
 */
const CATALOG_SOURCE = 'admin_upload';
const RESERVED_SLUGS = ['trending', 'featured', 'popular'];
const DEFAULT_PAGE_SIZE = 20;

function isModerated(data: DocumentData): boolean {
  const status = (data.moderationStatus as string) ?? 'active';
  return status === 'hidden' || status === 'removed';
}

function toGistoneerSound(doc: QueryDocumentSnapshot): GistoneerSound {
  const data = doc.data();
  return {
    id: doc.id,
    provider: 'firestore',
    providerTrackId: doc.id,
    title: data.title,
    ...(data.artist ? {artist: data.artist} : {}),
    ...(data.album ? {album: data.album} : {}),
    durationMs: data.durationMs ?? 0,
    ...(data.artworkUrl ? {artworkUrl: data.artworkUrl} : {}),
    // Real audio, not a mock placeholder — this provider only ever returns
    // real, uploaded-and-processed tracks.
    previewUrl: data.audioUrl,
    ...(data.genre ? {genre: data.genre, genres: [data.genre]} : {}),
    // Original Gistoneer platform uploads, not third-party licensed content —
    // 'licensed' is the honest status (the platform/admin has the rights),
    // not a fabricated value for a concept that doesn't really apply here.
    license: {status: 'licensed', commercialAllowed: true},
    isAvailable: true,
    createdAt: data.createdAt?.toDate?.().toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString(),
  };
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), 50);
}

/**
 * `orderField` must match whatever field the caller already applied a range
 * filter on, if any — Firestore requires the first orderBy to be the same
 * field as an inequality filter (getByCategory has none, so it orders by
 * createdAt; search has a range filter on titleLower, so it must order by
 * titleLower instead, or Firestore rejects the query outright, not just
 * "needs an index").
 */
async function runPagedQuery(query: Query, params: PageParams | undefined, orderField: 'createdAt' | 'titleLower'): Promise<Page<GistoneerSound>> {
  const limit = clampLimit(params?.limit);
  const dir = orderField === 'createdAt' ? 'desc' : 'asc';
  let q = query.orderBy(orderField, dir).orderBy('__name__', dir).limit(limit);

  if (params?.cursor) {
    const cursorSnap = await db.collection('sounds').doc(params.cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get(orderField), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const items = snap.docs.filter((doc) => !isModerated(doc.data())).map(toGistoneerSound);
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : undefined;
  return {items, nextCursor};
}

async function findCategoryBySlug(slug: string): Promise<{id: string} | null> {
  const snap = await db.collection('soundCategories').where('slug', '==', slug).where('isActive', '==', true).limit(1).get();
  return snap.empty ? null : {id: snap.docs[0].id};
}

export const firestoreCatalogProvider: SoundProviderAdapter = {
  id: 'firestore',

  async search(query, params) {
    const q = query.trim().toLowerCase();
    if (!q) return {items: []};
    return runPagedQuery(
      db
        .collection('sounds')
        .where('source', '==', CATALOG_SOURCE)
        .where('visibility', '==', 'public')
        .where('titleLower', '>=', q)
        .where('titleLower', '<=', q + ''),
      params,
      'titleLower',
    );
  },

  async getTrack(providerTrackId) {
    const snap = await db.collection('sounds').doc(providerTrackId).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (data.source !== CATALOG_SOURCE || data.visibility !== 'public' || isModerated(data)) return null;
    return toGistoneerSound(snap as QueryDocumentSnapshot);
  },

  async getTrending(params) {
    const category = await findCategoryBySlug('trending');
    if (!category) return {items: []};
    return this.getByCategory(category.id, params);
  },

  async getPopular(params) {
    const category = await findCategoryBySlug('popular');
    if (!category) return {items: []};
    return this.getByCategory(category.id, params);
  },

  async getFeatured(params) {
    const category = await findCategoryBySlug('featured');
    if (!category) return {items: []};
    return this.getByCategory(category.id, params);
  },

  async getCategories(): Promise<SoundCategory[]> {
    const snap = await db.collection('soundCategories').where('isActive', '==', true).orderBy('sortOrder', 'asc').get();
    return snap.docs
      .filter((doc) => !RESERVED_SLUGS.includes(doc.data().slug))
      .map((doc) => ({id: doc.id, label: doc.data().name as string}));
  },

  async getByCategory(categoryId, params) {
    return runPagedQuery(
      db.collection('sounds').where('source', '==', CATALOG_SOURCE).where('visibility', '==', 'public').where('categoryIds', 'array-contains', categoryId),
      params,
      'createdAt',
    );
  },
};
