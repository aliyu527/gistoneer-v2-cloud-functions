import {FieldValue, FieldPath} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
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
 * Comment-level likes — the exact same pattern as posts/interactions.ts's
 * likePost/unlikePost, just scoped one level deeper (a comment lives at
 * posts/{postId}/comments/{commentId}). Comment ids are Firestore
 * auto-ids, globally unique regardless of which post's subcollection they
 * live in, so `{uid}_{commentId}` is enough of a key without also folding
 * in postId.
 */
export async function likeComment(uid: string, postId: string, commentId: string): Promise<void> {
  const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) {
    throw new HttpsError('not-found', "We couldn't find that comment.");
  }
  const likeRef = db.collection('commentLikes').doc(`${uid}_${commentId}`);
  const existing = await likeRef.get();
  if (existing.exists) return;
  await likeRef.set({uid, postId, commentId, createdAt: FieldValue.serverTimestamp()});
  await commentRef.update({likeCount: FieldValue.increment(1)});
}

export async function unlikeComment(uid: string, postId: string, commentId: string): Promise<void> {
  const likeRef = db.collection('commentLikes').doc(`${uid}_${commentId}`);
  const existing = await likeRef.get();
  if (!existing.exists) return;
  await likeRef.delete();
  await db.collection('posts').doc(postId).collection('comments').doc(commentId).update({likeCount: FieldValue.increment(-1)});
}

/** Batched "did I like this comment" lookup — mirrors posts/interactions.ts:getMyPostInteractions's exact chunking approach. */
export async function getMyCommentInteractions(uid: string, commentIds: string[]): Promise<Record<string, boolean>> {
  const deduped = [...new Set(commentIds)];
  const result: Record<string, boolean> = {};
  deduped.forEach((id) => {
    result[id] = false;
  });
  if (deduped.length === 0) return result;

  const compositeIds = deduped.map((commentId) => `${uid}_${commentId}`);
  await Promise.all(
    chunk(compositeIds, FIRESTORE_IN_QUERY_LIMIT).map(async (batch) => {
      const snap = await db.collection('commentLikes').where(FieldPath.documentId(), 'in', batch).get();
      snap.docs.forEach((doc) => {
        const commentId = doc.data().commentId as string;
        if (commentId in result) result[commentId] = true;
      });
    }),
  );

  return result;
}
