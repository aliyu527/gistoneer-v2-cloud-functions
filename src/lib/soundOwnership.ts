import {FieldPath} from 'firebase-admin/firestore';
import {db} from '../admin';
import {getSoundDetail} from '../sounds/service';

const FIRESTORE_IN_QUERY_LIMIT = 10;

/**
 * A playlist entry references either the caller's own personal-library
 * sound (a bare `sounds/{id}` doc id, unchanged/original behavior) or a
 * public catalog track (this prefix + providerTrackId) — Gistoneer Sounds
 * discovery. Same string-prefix convention duplicated on the client
 * (Services/Music/playlistTracks.ts) — kept in sync manually, matching how
 * urlValidation's regex is already byte-for-byte duplicated client/server
 * elsewhere in this codebase.
 */
export const CATALOG_SOUND_ID_PREFIX = 'catalog:';

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Playlists reference sounds by ID — never trust that a client-supplied
 * soundIds list actually belongs to the caller (same posture as every other
 * upload/media reference this session re-verifies server-side). Batches via
 * Firestore's `in` operator (capped at 10 values) rather than one read per
 * ID, and filters ownership client-side in this function rather than
 * chaining a second `where` clause, avoiding a composite-index requirement
 * for a query already filtering on document ID. Returns only the IDs that
 * both exist and are owned by `uid`, in the same order they were given.
 */
export async function verifyOwnedSoundIds(soundIds: string[], uid: string): Promise<string[]> {
  const deduped = [...new Set(soundIds)];
  const owned = new Set<string>();

  await Promise.all(
    chunk(deduped, FIRESTORE_IN_QUERY_LIMIT).map(async (batch) => {
      const snap = await db.collection('sounds').where(FieldPath.documentId(), 'in', batch).get();
      snap.docs.forEach((doc) => {
        if (doc.data().ownerId === uid) owned.add(doc.id);
      });
    }),
  );

  // Filtering `deduped` (not the raw, possibly-repeated `soundIds`) also
  // enforces the "no duplicate track in a playlist" policy as a side effect.
  return deduped.filter((id) => owned.has(id));
}

/** Same "blocked" definition createPost.ts already uses for a CATALOG audio layer — kept identical rather than a subtly-different second definition. */
function isCatalogTrackBlocked(track: Awaited<ReturnType<typeof getSoundDetail>>): boolean {
  return (
    !track ||
    !track.isAvailable ||
    track.license.status === 'unavailable' ||
    track.license.status === 'territoryRestricted' ||
    track.license.status === 'restricted'
  );
}

/**
 * Catalog tracks aren't owned by anyone — any existing, available,
 * non-restricted track can go in any playlist (same posture createPost.ts
 * already applies when a post itself uses one). Existence/availability
 * only, never an ownership check.
 */
async function verifyAvailableCatalogTrackIds(providerTrackIds: string[]): Promise<string[]> {
  const deduped = [...new Set(providerTrackIds)];
  const results = await Promise.all(
    deduped.map(async (id) => {
      const track = await getSoundDetail(id);
      return isCatalogTrackBlocked(track) ? null : id;
    }),
  );
  return results.filter((id): id is string => id !== null);
}

/**
 * The combined verification updatePlaylist/createPlaylist/addSoundToPlaylist
 * all use for a playlist's soundIds — splits by the CATALOG_SOUND_ID_PREFIX
 * convention, verifies each half with its own rules (ownership for library,
 * availability for catalog), and recombines in original order. A playlist's
 * soundIds array can freely mix both kinds of entries.
 */
export async function verifyPlaylistSoundIds(ids: string[], uid: string): Promise<string[]> {
  const deduped = [...new Set(ids)];
  const libraryIds = deduped.filter((id) => !id.startsWith(CATALOG_SOUND_ID_PREFIX));
  const catalogTrackIds = deduped
    .filter((id) => id.startsWith(CATALOG_SOUND_ID_PREFIX))
    .map((id) => id.slice(CATALOG_SOUND_ID_PREFIX.length));

  const [verifiedLibraryIds, verifiedCatalogTrackIds] = await Promise.all([
    libraryIds.length > 0 ? verifyOwnedSoundIds(libraryIds, uid) : Promise.resolve([] as string[]),
    catalogTrackIds.length > 0 ? verifyAvailableCatalogTrackIds(catalogTrackIds) : Promise.resolve([] as string[]),
  ]);

  const verifiedLibrarySet = new Set(verifiedLibraryIds);
  const verifiedCatalogSet = new Set(verifiedCatalogTrackIds.map((id) => `${CATALOG_SOUND_ID_PREFIX}${id}`));
  return deduped.filter((id) => (id.startsWith(CATALOG_SOUND_ID_PREFIX) ? verifiedCatalogSet.has(id) : verifiedLibrarySet.has(id)));
}
