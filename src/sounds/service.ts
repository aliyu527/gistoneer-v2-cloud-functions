import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {getActiveProvider} from './providerRegistry';
import type {GistoneerSound, Page, PageParams} from './types';

/**
 * Thin functions over the active provider — imported directly by both the
 * callables (functions/src/functions/sounds/*) and createPost.ts's
 * publish-time validation. Not a second implementation of anything; just
 * the one place that knows which provider is active.
 */
export async function searchSounds(query: string, params?: PageParams): Promise<Page<GistoneerSound>> {
  return getActiveProvider().search(query, params);
}

export async function getSoundDetail(providerTrackId: string): Promise<GistoneerSound | null> {
  return getActiveProvider().getTrack(providerTrackId);
}

export async function getCatalogHome(): Promise<{
  featured: GistoneerSound[];
  trending: GistoneerSound[];
  popular: GistoneerSound[];
  genres: {id: string; label: string}[];
}> {
  const provider = getActiveProvider();
  const [featured, trending, popular, genres] = await Promise.all([
    provider.getFeatured({limit: 10}),
    provider.getTrending({limit: 10}),
    provider.getPopular({limit: 10}),
    provider.getCategories(),
  ]);
  return {featured: featured.items, trending: trending.items, popular: popular.items, genres};
}

export async function getSoundsByGenre(categoryId: string, params?: PageParams): Promise<Page<GistoneerSound>> {
  return getActiveProvider().getByCategory(categoryId, params);
}

/**
 * Per-user save/unsave for catalog sounds — mirrors templateFavorites'
 * exact pattern (functions/src/templates/service.ts): idempotent
 * doc-existence check, {uid}_{trackId} composite key, no counter (no
 * existing consumer needs a save-count displayed).
 */
export async function saveSound(uid: string, trackId: string): Promise<void> {
  const ref = db.collection('savedSounds').doc(`${uid}_${trackId}`);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({uid, trackId, createdAt: FieldValue.serverTimestamp()});
}

export async function unsaveSound(uid: string, trackId: string): Promise<void> {
  const ref = db.collection('savedSounds').doc(`${uid}_${trackId}`);
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.delete();
}

// Module 13 hardening — this query had no cap at all (unbounded read/cost
// risk). Generous-but-bounded safety net, not a real pagination rebuild —
// no UI here needs more than a screenful of saved sounds today.
const MAX_SAVED_SOUNDS = 200;

export async function getSavedSoundIds(uid: string): Promise<string[]> {
  const snap = await db.collection('savedSounds').where('uid', '==', uid).limit(MAX_SAVED_SOUNDS).get();
  return snap.docs.map((d) => d.data().trackId as string);
}

/**
 * Hydrates saved track ids into full catalog sounds — mirrors
 * getFavoriteTemplates' exact per-id hydration. Note: this is a per-id
 * fetch (one provider.getTrack call per saved sound), currently free since
 * the active provider is the in-memory mock (providerRegistry.ts). Revisit
 * with a real batch-lookup once a real provider is wired in — not building
 * a speculative batch API against an interface with no real implementation yet.
 */
export async function getSavedSounds(uid: string): Promise<GistoneerSound[]> {
  const ids = await getSavedSoundIds(uid);
  const provider = getActiveProvider();
  const tracks = await Promise.all(ids.map((id) => provider.getTrack(id)));
  return tracks.filter((t): t is GistoneerSound => t !== null);
}
