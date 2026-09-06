import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';

export type NotificationType =
  | 'like'
  | 'comment'
  | 'mention'
  | 'tag'
  | 'follow'
  | 'live'
  | 'live_invite'
  | 'live_recording_ready'
  | 'announcement'
  | 'vendor_approved'
  | 'vendor_rejected'
  | 'listing_suspended';

export interface NotificationActor {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface CreateNotificationInput {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  /** Absent for 'follow'/'live'/'live_invite'/'announcement' — none of those have a post. */
  postId?: string;
  commentId?: string;
  /** comment type only — true when this notifies a reply to the recipient's own comment, rather than a comment on the recipient's post. Lets the client render "replied to your comment" vs "commented on your post" without an extra read. */
  isReply?: boolean;
  /** live/live_invite types only. */
  liveId?: string;
  /** announcement type only — the admin's own message text, since there's no real actor/entity to compute inbox copy from. */
  title?: string;
  body?: string;
  /** announcement type only — the Module 08 admin send's own campaign id (an adminAuditLogs doc id), used as this type's idempotency-key suffix instead of a post/live id. */
  campaignId?: string;
  /** Skips the live users/{actorId} lookup and uses this directly — announcement/vendor_approved/vendor_rejected/listing_suspended's actorId ('system') has no real user doc to denormalize from. */
  actorOverride?: NotificationActor;
  /** vendor_rejected/listing_suspended types only — the admin's stated reason. */
  reason?: string;
  /** listing_suspended type only. */
  listingId?: string;
}

function buildActor(userData: FirebaseFirestore.DocumentData): NotificationActor {
  const actor: NotificationActor = {};
  if (userData.username) actor.username = userData.username;
  if (userData.displayName) actor.displayName = userData.displayName;
  if (userData.photoURL) actor.avatarUrl = userData.photoURL;
  return actor;
}

/**
 * Every event type with real backing data in this app (Like, Comment,
 * Mention, Tag, Follow, Live, Live Invite, Live Recording Ready) — no
 * message/push infrastructure exists to notify from, a disclosed scope
 * decision, not an oversight (each of these only ever reaches this
 * Firestore doc — actual push/FCM delivery is out of scope for all of
 * them). Called inline from the existing likePost/createComment/
 * createPost/followUser/goLive/inviteToLive/onRecordingEvent code (never a
 * separate trigger) — matches this codebase's established "no duplicate
 * infrastructure" posture.
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
export async function createNotification({
  recipientId,
  actorId,
  type,
  postId,
  commentId,
  isReply,
  liveId,
  title,
  body,
  campaignId,
  actorOverride,
  reason,
  listingId,
}: CreateNotificationInput): Promise<void> {
  // "Never notify yourself" is a social-interaction rule (liking/following/
  // tagging yourself makes no sense) — it doesn't apply to a system
  // notification ABOUT the recipient's own asset, where actorId is only
  // ever the recipient themselves by construction (no other real actor
  // exists for "your recording is ready"), nor to a system-originated
  // message (actorId is the fixed 'system' sentinel, never a real
  // recipient's own uid) — announcement, and Marketplace's
  // vendor_approved/vendor_rejected/listing_suspended.
  const SYSTEM_TYPES: NotificationType[] = ['live_recording_ready', 'announcement', 'vendor_approved', 'vendor_rejected', 'listing_suspended'];
  if (recipientId === actorId && !SYSTEM_TYPES.includes(type)) return;

  const actor = actorOverride ?? buildActor((await db.collection('users').doc(actorId).get()).data() ?? {});

  const data = {
    recipientId,
    actorId,
    actor,
    type,
    ...(postId ? {postId} : {}),
    ...(commentId ? {commentId} : {}),
    ...(isReply ? {isReply: true} : {}),
    ...(liveId ? {liveId} : {}),
    ...(title ? {title} : {}),
    ...(body ? {body} : {}),
    ...(reason ? {reason} : {}),
    ...(listingId ? {listingId} : {}),
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (type === 'comment') {
    await db.collection('notifications').add(data);
    return;
  }

  const idSuffix =
    type === 'like'
      ? `${postId}_${actorId}`
      : type === 'follow'
        ? actorId
        : type === 'live' || type === 'live_invite'
          ? liveId
          : type === 'announcement'
            ? campaignId
            : type === 'vendor_approved' || type === 'vendor_rejected'
              ? actorId
              : type === 'listing_suspended'
                ? listingId
                : postId;
  const ref = db.collection('notifications').doc(`${recipientId}_${type}_${idSuffix}`);
  await ref.set(data, {merge: true});
}
