import {FieldPath, FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {getActiveProvider} from './providerRegistry';
import type {GistoneerSound, Page, PageParams, SavedSound} from './types';

const FIRESTORE_IN_QUERY_LIMIT = 10;

/**
 * A saved sound id is either a catalog track (this prefix + providerTrackId)
 * or a bare personal-library sounds/{id} doc id — same convention
 * soundOwnership.ts already established for playlist soundIds. Duplicated
 * here (not imported) because soundOwnership.ts itself imports getSoundDetail
 * from this file — importing back would be circular.
 */
const CATALOG_SOUND_ID_PREFIX = 'catalog:';

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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
 * Hydrates saved ids — each is either a catalog track (`catalog:` prefix) or
 * a personal-library sound (bare sounds/{id} doc id) — into full objects,
 * tagged with `kind` so the client can render/route each correctly. Mirrors
 * verifyPlaylistSoundIds' split/hydrate/recombine-in-order shape. A saved
 * library sound is included only if it's still public or still owned by the
 * caller (it may have been made private since being saved) — same
 * "unresolvable → silently dropped" posture getFavoriteTemplates/
 * resolvePlaylistTracks already use for a stale/blocked reference.
 */
export async function getSavedSounds(uid: string): Promise<SavedSound[]> {
  const ids = await getSavedSoundIds(uid);
  const catalogIds = ids.filter((id) => id.startsWith(CATALOG_SOUND_ID_PREFIX)).map((id) => id.slice(CATALOG_SOUND_ID_PREFIX.length));
  const libraryIds = ids.filter((id) => !id.startsWith(CATALOG_SOUND_ID_PREFIX));

  const provider = getActiveProvider();
  const [catalogTracks, libraryDocs] = await Promise.all([
    Promise.all(catalogIds.map((id) => provider.getTrack(id))),
    Promise.all(
      chunk([...new Set(libraryIds)], FIRESTORE_IN_QUERY_LIMIT).map((batch) =>
        db.collection('sounds').where(FieldPath.documentId(), 'in', batch).get(),
      ),
    ),
  ]);

  const catalogById = new Map(catalogIds.map((id, i) => [id, catalogTracks[i]] as const));
  const libraryById = new Map(
    libraryDocs
      .flatMap((snap) => snap.docs)
      .filter((doc) => doc.data().status === 'ready' && (doc.data().visibility === 'public' || doc.data().ownerId === uid))
      .map((doc) => [doc.id, doc.data()] as const),
  );

  return ids
    .map((id): SavedSound | null => {
      if (id.startsWith(CATALOG_SOUND_ID_PREFIX)) {
        const track = catalogById.get(id.slice(CATALOG_SOUND_ID_PREFIX.length));
        return track ? {kind: 'CATALOG', ...track} : null;
      }
      const sound = libraryById.get(id);
      if (!sound) return null;
      return {
        kind: 'LIBRARY',
        id,
        title: sound.title,
        artist: sound.artist,
        album: sound.album,
        genre: sound.genre,
        durationMs: sound.durationMs,
        audioUrl: sound.audioUrl,
        artworkUrl: sound.artworkUrl ?? null,
      };
    })
    .filter((s): s is SavedSound => s !== null);
}
