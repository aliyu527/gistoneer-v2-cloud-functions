import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminContentListItem, ModerationStatus} from './adminListContent';

interface AdminContentMediaFull {
  type: 'photo' | 'video';
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

interface AdminContentLayer {
  type: string;
  trackId: string;
  source: string;
  title: string;
  artist: string | null;
  durationMs: number | null;
}

export interface AdminContentDetail extends Omit<AdminContentListItem, 'media'> {
  media: AdminContentMediaFull[];
  hashtags: string[];
  mentions: string[];
  location: {name: string} | null;
  link: {url: string} | null;
  taggedUsers: string[];
  layers: AdminContentLayer[];
  soundTrackIds: string[];
  allowComments: boolean;
  status: 'published' | 'draft';
  updatedAt: string | null;
  isFromLive: boolean;
  creator: {status: 'active' | 'suspended' | null; currentUsername: string | null; currentAvatarUrl: string | null} | null;
  lastModeration: {action: 'content.hide' | 'content.remove'; reason: string | null; at: string | null; byEmail: string | null} | null;
}

interface AdminGetContentDetailRequest {
  postId: string;
}

/**
 * Full admin content record. `layers`/`author`/`counts` are already
 * denormalized onto the post document (confirmed via Module 05 audit), so
 * the only extra read here is ONE fresh users/{authorId} lookup for the
 * creator's current status/avatar (a single detail-page read, not an N+1
 * concern) plus, only when the post is currently moderated, one audit-log
 * lookup for the reason shown to the admin.
 */
export const adminGetContentDetail = onCall<AdminGetContentDetailRequest, Promise<AdminContentDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'content.read');

  const postId = request.data?.postId;
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing postId.');
  }

  const snap = await db.collection('posts').doc(postId).get();
  if (!snap.exists || snap.data()?.status !== 'published') {
    throw new HttpsError('not-found', 'This content could not be found.');
  }
  const data = snap.data()!;
  const moderationStatus = (data.moderationStatus as ModerationStatus) ?? 'active';
  const author = (data.author as Record<string, unknown>) ?? {};
  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];
  const counts = (data.counts as Record<string, unknown>) ?? {};
  const layers = Array.isArray(data.layers) ? (data.layers as Record<string, unknown>[]) : [];

  const [creatorSnap, lastModerationSnap] = await Promise.all([
    db.collection('users').doc(data.authorId as string).get(),
    moderationStatus !== 'active'
      ? db
          .collection('adminAuditLogs')
          .where('targetId', '==', postId)
          .where('targetType', '==', 'content')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get()
      : Promise.resolve(null),
  ]);

  let creator: AdminContentDetail['creator'] = null;
  if (creatorSnap.exists) {
    const creatorData = creatorSnap.data()!;
    creator = {
      status: (creatorData.status as 'active' | 'suspended') ?? 'active',
      currentUsername: (creatorData.username as string) ?? null,
      currentAvatarUrl: (creatorData.photoURL as string) ?? null,
    };
  }

  let lastModeration: AdminContentDetail['lastModeration'] = null;
  if (lastModerationSnap && !lastModerationSnap.empty) {
    const entry = lastModerationSnap.docs[0].data();
    lastModeration = {
      action: entry.action as 'content.hide' | 'content.remove',
      reason: (entry.reason as string) ?? null,
      at: entry.createdAt?.toDate?.().toISOString() ?? null,
      byEmail: (entry.actorEmail as string) ?? null,
    };
  }

  return {
    id: snap.id,
    authorId: (data.authorId as string) ?? '',
    author: {
      userId: (author.userId as string) ?? (data.authorId as string) ?? '',
      username: (author.username as string) ?? null,
      displayName: (author.displayName as string) ?? null,
      avatarUrl: (author.avatarUrl as string) ?? null,
    },
    caption: (data.caption as string) ?? '',
    media: media.map((item) => ({
      type: (item.type as 'photo' | 'video') ?? 'photo',
      url: (item.url as string) ?? '',
      thumbnailUrl: (item.thumbnailUrl as string) ?? null,
      width: typeof item.width === 'number' ? item.width : null,
      height: typeof item.height === 'number' ? item.height : null,
      duration: typeof item.duration === 'number' ? item.duration : null,
    })),
    mediaCount: media.length,
    audience: (data.audience as AdminContentDetail['audience']) ?? 'public',
    moderationStatus,
    counts: {
      likes: typeof counts.likes === 'number' ? counts.likes : 0,
      comments: typeof counts.comments === 'number' ? counts.comments : 0,
      bookmarks: typeof counts.bookmarks === 'number' ? counts.bookmarks : 0,
      shares: typeof counts.shares === 'number' ? counts.shares : 0,
    },
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    hashtags: Array.isArray(data.hashtags) ? (data.hashtags as string[]) : [],
    mentions: Array.isArray(data.mentions) ? (data.mentions as string[]) : [],
    location: data.location ? {name: (data.location as Record<string, unknown>).name as string} : null,
    link: data.link ? {url: (data.link as Record<string, unknown>).url as string} : null,
    taggedUsers: Array.isArray(data.taggedUsers) ? (data.taggedUsers as {userId: string}[]).map((t) => t.userId) : [],
    layers: layers.map((layer) => ({
      type: (layer.type as string) ?? '',
      trackId: (layer.trackId as string) ?? '',
      source: (layer.source as string) ?? '',
      title: (layer.title as string) ?? '',
      artist: (layer.artist as string) ?? null,
      durationMs: typeof layer.durationMs === 'number' ? layer.durationMs : null,
    })),
    soundTrackIds: Array.isArray(data.soundTrackIds) ? (data.soundTrackIds as string[]) : [],
    allowComments: Boolean(data.allowComments),
    status: (data.status as 'published' | 'draft') ?? 'published',
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    isFromLive: postId.startsWith('live-') || typeof data.sourceLiveVisibility === 'string',
    creator,
    lastModeration,
  };
});
