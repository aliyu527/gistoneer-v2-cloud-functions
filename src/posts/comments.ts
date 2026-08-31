import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {enforceRateLimit} from '../lib/rateLimit';
import {createNotification} from '../notifications/service';

const MAX_COMMENT_LENGTH = 500;
const DEFAULT_COMMENTS_LIMIT = 50;
const DEFAULT_REPLIES_LIMIT = 20;

export interface PostCommentAuthor {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface PostComment {
  id: string;
  authorId: string;
  author: PostCommentAuthor;
  text: string;
  createdAt: string;
  /** null for a top-level comment — always explicitly stored (never omitted), since getComments' top-level query filters on it. */
  parentCommentId: string | null;
  replyCount: number;
  likeCount: number;
}

function buildAuthor(userData: FirebaseFirestore.DocumentData): PostCommentAuthor {
  const author: PostCommentAuthor = {};
  if (userData.username) author.username = userData.username;
  if (userData.displayName) author.displayName = userData.displayName;
  if (userData.photoURL) author.avatarUrl = userData.photoURL;
  return author;
}

function toPostComment(id: string, data: FirebaseFirestore.DocumentData): PostComment {
  return {
    id,
    authorId: data.authorId,
    author: (data.author ?? {}) as PostCommentAuthor,
    text: data.text,
    createdAt: (data.createdAt?.toDate?.() ?? new Date()).toISOString(),
    parentCommentId: data.parentCommentId ?? null,
    replyCount: data.replyCount ?? 0,
    likeCount: data.likeCount ?? 0,
  };
}

/**
 * Real comments with one level of replies (no further nesting — a reply
 * can't itself be replied to, matching the spec's own "threading" as a flat
 * two-tier structure rather than arbitrary depth) and real per-comment
 * likes. A top-level comment notifies the post's author; a reply notifies
 * the parent comment's author instead (whichever of the two isn't the
 * commenter themselves — createNotification's own recipientId===actorId
 * guard handles that). allowComments is enforced here, server-side, never
 * trusting the client to have already checked it — applies to replies too.
 */
export async function createComment(uid: string, postId: string, text: string, parentCommentId: string | null): Promise<PostComment> {
  await enforceRateLimit(uid, 'createComment', {maxPerWindow: 30, windowMs: 10 * 60 * 1000});

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new HttpsError('invalid-argument', 'Comment cannot be empty.');
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new HttpsError('invalid-argument', `Comments can be at most ${MAX_COMMENT_LENGTH} characters.`);
  }

  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError('not-found', "We couldn't find that post.");
  }
  if (postSnap.data()!.allowComments !== true) {
    throw new HttpsError('failed-precondition', 'Comments are turned off for this post.');
  }
  const postAuthorId = postSnap.data()!.authorId as string;

  let parentRef: FirebaseFirestore.DocumentReference | null = null;
  let parentAuthorId: string | null = null;
  if (parentCommentId) {
    parentRef = postRef.collection('comments').doc(parentCommentId);
    const parentSnap = await parentRef.get();
    if (!parentSnap.exists) {
      throw new HttpsError('not-found', "We couldn't find that comment.");
    }
    // Flat two-tier structure — a reply can't itself have a parentCommentId.
    if (parentSnap.data()!.parentCommentId) {
      throw new HttpsError('invalid-argument', "Can't reply to a reply.");
    }
    parentAuthorId = parentSnap.data()!.authorId as string;
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const author = buildAuthor(userSnap.data() ?? {});

  const commentRef = postRef.collection('comments').doc();
  const now = FieldValue.serverTimestamp();
  await commentRef.set({
    authorId: uid,
    author,
    text: trimmed,
    createdAt: now,
    parentCommentId: parentCommentId ?? null,
    replyCount: 0,
    likeCount: 0,
  });
  // Total comment count includes replies — same "everything you'd see if
  // you opened Comments" mental model TikTok/IG's own counter uses.
  await postRef.update({'counts.comments': FieldValue.increment(1)});
  if (parentRef) {
    await parentRef.update({replyCount: FieldValue.increment(1)});
  }

  await createNotification({
    recipientId: parentAuthorId ?? postAuthorId,
    actorId: uid,
    type: 'comment',
    postId,
    commentId: commentRef.id,
    isReply: !!parentAuthorId,
  });

  return {
    id: commentRef.id,
    authorId: uid,
    author,
    text: trimmed,
    createdAt: new Date().toISOString(),
    parentCommentId: parentCommentId ?? null,
    replyCount: 0,
    likeCount: 0,
  };
}

/** Top-level comments only (parentCommentId == null) — replies are fetched separately, on demand, via getReplies. */
export async function getComments(postId: string, limitCount: number = DEFAULT_COMMENTS_LIMIT): Promise<PostComment[]> {
  const snap = await db
    .collection('posts')
    .doc(postId)
    .collection('comments')
    .where('parentCommentId', '==', null)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map((doc) => toPostComment(doc.id, doc.data()));
}

/** Direct replies to one top-level comment — newest first, same ordering as top-level comments (and reuses the same composite index). */
export async function getReplies(postId: string, commentId: string, limitCount: number = DEFAULT_REPLIES_LIMIT): Promise<PostComment[]> {
  const snap = await db
    .collection('posts')
    .doc(postId)
    .collection('comments')
    .where('parentCommentId', '==', commentId)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map((doc) => toPostComment(doc.id, doc.data()));
}
