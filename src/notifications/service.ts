import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';

export type NotificationType = 'like' | 'comment' | 'mention' | 'tag' | 'follow';

export interface NotificationActor {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface CreateNotificationInput {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  /** Absent for 'follow' — a follow notification has no post. */
  postId?: string;
  commentId?: string;
  /** comment type only — true when this notifies a reply to the recipient's own comment, rather than a comment on the recipient's post. Lets the client render "replied to your comment" vs "commented on your post" without an extra read. */
  isReply?: boolean;
}

function buildActor(userData: FirebaseFirestore.DocumentData): NotificationActor {
  const actor: NotificationActor = {};
  if (userData.username) actor.username = userData.username;
  if (userData.displayName) actor.displayName = userData.displayName;
  if (userData.photoURL) actor.avatarUrl = userData.photoURL;
  return actor;
}

/**
 * The five event types with real backing data in this app (Like, Comment,
 * Mention, Tag, Follow) — no message/live/push infrastructure exists to
 * notify from, a disclosed scope decision, not an oversight. Called inline
 * from the existing likePost/createComment/createPost/followUser Cloud
 * Functions (never a separate trigger) — matches this codebase's
 * established "no duplicate infrastructure" posture.
 *
 * Deterministic ids for like/mention/tag/follow (`${recipientId}_${type}_${postId}`,
 * plus actorId for like/follow since multiple people can like the same post
 * or follow the same user) make re-liking/re-following after unliking/
 * unfollowing, or re-publishing, idempotent rather than spamming duplicate
 * notifications — mirrors postLikes'/commentLikes'/follows' own
 * doc-id-as-idempotency-key pattern. Comment gets a fresh auto-id since
 * every comment is a genuinely new event, never a repeat of a prior one.
 */
export async function createNotification({recipientId, actorId, type, postId, commentId, isReply}: CreateNotificationInput): Promise<void> {
  if (recipientId === actorId) return; // never notify yourself

  const actorSnap = await db.collection('users').doc(actorId).get();
  const actor = buildActor(actorSnap.data() ?? {});

  const data = {
    recipientId,
    actorId,
    actor,
    type,
    ...(postId ? {postId} : {}),
    ...(commentId ? {commentId} : {}),
    ...(isReply ? {isReply: true} : {}),
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (type === 'comment') {
    await db.collection('notifications').add(data);
    return;
  }

  const idSuffix = type === 'like' ? `${postId}_${actorId}` : type === 'follow' ? actorId : postId;
  const ref = db.collection('notifications').doc(`${recipientId}_${type}_${idSuffix}`);
  await ref.set(data, {merge: true});
}
