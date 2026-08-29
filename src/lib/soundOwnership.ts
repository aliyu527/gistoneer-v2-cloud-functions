import {FieldPath} from 'firebase-admin/firestore';
import {db} from '../admin';

const FIRESTORE_IN_QUERY_LIMIT = 10;

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
