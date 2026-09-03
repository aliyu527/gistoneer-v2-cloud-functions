import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';

export type NotificationType = 'like' | 'comment' | 'mention' | 'tag' | 'follow' | 'live' | 'live_invite';

export interface NotificationActor {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface CreateNotificationInput {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  /** Absent for 'follow'/'live'/'live_invite' — none of those have a post. */
  postId?: string;
  commentId?: string;
  /** comment type only — true when this notifies a reply to the recipient's own comment, rather than a comment on the recipient's post. Lets the client render "replied to your comment" vs "commented on your post" without an extra read. */
  isReply?: boolean;
  /** live/live_invite types only. */
  liveId?: string;
}

function buildActor(userData: FirebaseFirestore.DocumentData): NotificationActor {
  const actor: NotificationActor = {};
  if (userData.username) actor.username = userData.username;
  if (userData.displayName) actor.displayName = userData.displayName;
  if (userData.photoURL) actor.avatarUrl = userData.photoURL;
  return actor;
}

/**
 * The six event types with real backing data in this app (Like, Comment,
 * Mention, Tag, Follow, Live) — no message/push infrastructure exists to
 * notify from, a disclosed scope decision, not an oversight (Live itself
 * only reaches this Firestore doc — actual push/FCM delivery is out of
 * scope, same as every other type here). Called inline from the existing
 * likePost/createComment/createPost/followUser/goLive Cloud Functions
 * (never a separate trigger) — matches this codebase's established "no
 * duplicate infrastructure" posture.
 *
 * Deterministic ids for like/mention/tag/follow/live (`${recipientId}_${type}_${postId}`,
 * plus actorId for like/follow since multiple people can like the same post
 * or follow the same user, or liveId for live since the same host can
 * broadcast again) make re-liking/re-following/re-broadcasting after
 * unliking/unfollowing/ending a prior live idempotent rather than spamming
 * duplicate notifications — mirrors postLikes'/commentLikes'/follows' own
 * doc-id-as-idempotency-key pattern. Comment gets a fresh auto-id since
 * every comment is a genuinely new event, never a repeat of a prior one.
 */
export async function createNotification({recipientId, actorId, type, postId, commentId, isReply, liveId}: CreateNotificationInput): Promise<void> {
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
    ...(liveId ? {liveId} : {}),
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (type === 'comment') {
    await db.collection('notifications').add(data);
    return;
  }

  const idSuffix =
    type === 'like' ? `${postId}_${actorId}` : type === 'follow' ? actorId : type === 'live' || type === 'live_invite' ? liveId : postId;
  const ref = db.collection('notifications').doc(`${recipientId}_${type}_${idSuffix}`);
  await ref.set(data, {merge: true});
}
