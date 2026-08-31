import {FieldValue, FieldPath} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {createNotification} from '../notifications/service';

const FIRESTORE_IN_QUERY_LIMIT = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Returns the post's authorId (needed by likePost to notify them) — throws if the post doesn't exist. */
async function verifyPostExists(postId: string): Promise<string> {
  const snap = await db.collection('posts').doc(postId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', "We couldn't find that post.");
  }
  return snap.data()!.authorId as string;
}

/**
 * Mirrors templates/service.ts's favoriteTemplate/unfavoriteTemplate exactly:
 * a doc keyed `{uid}_{postId}` for idempotent create/delete (existence
 * checked, not transactional — same accepted-risk posture as that
 * precedent) plus a FieldValue.increment on the post's own denormalized
 * counts field, so reading a post's like count never requires scanning
 * postLikes itself.
 */
export async function likePost(uid: string, postId: string): Promise<void> {
  const authorId = await verifyPostExists(postId);
  const ref = db.collection('postLikes').doc(`${uid}_${postId}`);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({uid, postId, createdAt: FieldValue.serverTimestamp()});
  await db.collection('posts').doc(postId).update({'counts.likes': FieldValue.increment(1)});
  await createNotification({recipientId: authorId, actorId: uid, type: 'like', postId});
}

export async function unlikePost(uid: string, postId: string): Promise<void> {
  const ref = db.collection('postLikes').doc(`${uid}_${postId}`);
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.delete();
  await db.collection('posts').doc(postId).update({'counts.likes': FieldValue.increment(-1)});
}

export async function bookmarkPost(uid: string, postId: string): Promise<void> {
  await verifyPostExists(postId);
  const ref = db.collection('postBookmarks').doc(`${uid}_${postId}`);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({uid, postId, createdAt: FieldValue.serverTimestamp()});
  await db.collection('posts').doc(postId).update({'counts.bookmarks': FieldValue.increment(1)});
}

export async function unbookmarkPost(uid: string, postId: string): Promise<void> {
  const ref = db.collection('postBookmarks').doc(`${uid}_${postId}`);
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.delete();
  await db.collection('posts').doc(postId).update({'counts.bookmarks': FieldValue.increment(-1)});
}

export interface PostInteractionState {
  liked: boolean;
  bookmarked: boolean;
}

/**
 * Batched "did I like/bookmark this" lookup for a page of feed posts —
 * chunked (Firestore `in` caps at 10) existence checks against the
 * deterministic `{uid}_{postId}` ids, mirroring
 * lib/userVerification.ts:verifyExistingUserIds's exact chunking approach.
 * Never scans postLikes/postBookmarks by uid — only ever looks up the
 * specific composite ids for the posts already on screen.
 */
export async function getMyPostInteractions(uid: string, postIds: string[]): Promise<Record<string, PostInteractionState>> {
  const deduped = [...new Set(postIds)];
  const result: Record<string, PostInteractionState> = {};
  deduped.forEach((id) => {
    result[id] = {liked: false, bookmarked: false};
  });
  if (deduped.length === 0) return result;

  const compositeIds = deduped.map((postId) => `${uid}_${postId}`);
  const batches = chunk(compositeIds, FIRESTORE_IN_QUERY_LIMIT);

  await Promise.all([
    ...batches.map(async (batch) => {
      const snap = await db.collection('postLikes').where(FieldPath.documentId(), 'in', batch).get();
      snap.docs.forEach((doc) => {
        const postId = doc.data().postId as string;
        if (result[postId]) result[postId].liked = true;
      });
    }),
    ...batches.map(async (batch) => {
      const snap = await db.collection('postBookmarks').where(FieldPath.documentId(), 'in', batch).get();
      snap.docs.forEach((doc) => {
        const postId = doc.data().postId as string;
        if (result[postId]) result[postId].bookmarked = true;
      });
    }),
  ]);

  return result;
}
