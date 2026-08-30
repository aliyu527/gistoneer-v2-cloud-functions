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
 * Tagging references users by ID — never trust that a client-supplied list
 * of user IDs actually exist (same posture as verifyOwnedSoundIds). Unlike
 * sound ownership, tagging isn't scoped to the caller's own resources: any
 * existing user can be tagged, so this only checks existence, not
 * ownership. Batches via Firestore's `in` operator (capped at 10) rather
 * than one read per ID. Returns only the IDs that exist, deduped, in the
 * same order they were given — a deleted/unavailable user is silently
 * dropped rather than failing the whole publish.
 */
export async function verifyExistingUserIds(userIds: string[]): Promise<string[]> {
  const deduped = [...new Set(userIds)];
  const existing = new Set<string>();

  await Promise.all(
    chunk(deduped, FIRESTORE_IN_QUERY_LIMIT).map(async (batch) => {
      const snap = await db.collection('users').where(FieldPath.documentId(), 'in', batch).get();
      snap.docs.forEach((doc) => existing.add(doc.id));
    }),
  );

  return deduped.filter((id) => existing.has(id));
}
