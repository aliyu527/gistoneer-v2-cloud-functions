import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export type ModerationStatus = 'active' | 'hidden' | 'removed';

export interface AdminContentMediaItem {
  type: 'photo' | 'video';
  url: string;
  thumbnailUrl: string | null;
}

export interface AdminContentListItem {
  id: string;
  authorId: string;
  author: {userId: string; username: string | null; displayName: string | null; avatarUrl: string | null};
  caption: string;
  media: AdminContentMediaItem[];
  mediaCount: number;
  audience: 'public' | 'followers' | 'private';
  moderationStatus: ModerationStatus;
  counts: {likes: number; comments: number; bookmarks: number; shares: number};
  createdAt: string | null;
}

interface AdminListContentRequest {
  moderationStatus?: ModerationStatus;
  audience?: 'public' | 'followers' | 'private';
  creatorId?: string;
  sortBy?: 'createdAt' | 'likes';
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListContentResponse {
  contents: AdminContentListItem[];
  nextCursor: string | null;
}

export function toContentListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminContentListItem {
  const data = doc.data();
  const author = (data.author as Record<string, unknown>) ?? {};
  const media = Array.isArray(data.media) ? (data.media as Record<string, unknown>[]) : [];
  const counts = (data.counts as Record<string, unknown>) ?? {};
  return {
    id: doc.id,
    authorId: (data.authorId as string) ?? '',
    author: {
      userId: (author.userId as string) ?? (data.authorId as string) ?? '',
      username: (author.username as string) ?? null,
      displayName: (author.displayName as string) ?? null,
      avatarUrl: (author.avatarUrl as string) ?? null,
    },
    caption: (data.caption as string) ?? '',
    media: media.slice(0, 1).map((item) => ({
      type: (item.type as 'photo' | 'video') ?? 'photo',
      url: (item.url as string) ?? '',
      thumbnailUrl: (item.thumbnailUrl as string) ?? null,
    })),
    mediaCount: media.length,
    audience: (data.audience as AdminContentListItem['audience']) ?? 'public',
    // Every post created before this module predates this field.
    moderationStatus: (data.moderationStatus as ModerationStatus) ?? 'active',
    counts: {
      likes: typeof counts.likes === 'number' ? counts.likes : 0,
      comments: typeof counts.comments === 'number' ? counts.comments : 0,
      bookmarks: typeof counts.bookmarks === 'number' ? counts.bookmarks : 0,
      shares: typeof counts.shares === 'number' ? counts.shares : 0,
    },
    createdAt: (data.createdAt as FirebaseFirestore.Timestamp)?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Paginated, filterable admin content list. Always `status=='published'` —
 * drafts are unreviewed live-recordings, not admin-manageable content, same
 * convention getDashboardOverview/getTopContent already use. Filters are
 * used one at a time (not combined) to keep the composite-index list
 * minimal and traceable to an actual exposed UI combination (see
 * firestore.indexes.json) — `sortBy: 'likes'` is only valid with no filter.
 * `author`/`counts` are already denormalized onto every post, so this needs
 * zero N+1 creator lookups.
 */
export const adminListContent = onCall<AdminListContentRequest, Promise<AdminListContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'content.read');

  const {moderationStatus, audience, creatorId, sortBy = 'createdAt', sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('posts').where('status', '==', 'published');
  if (moderationStatus) {
    q = q.where('moderationStatus', '==', moderationStatus);
  } else if (audience) {
    q = q.where('audience', '==', audience);
  } else if (creatorId) {
    q = q.where('authorId', '==', creatorId);
  }

  if (sortBy === 'likes') {
    q = q.orderBy('counts.likes', sortDir).orderBy('__name__', sortDir);
  } else {
    q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir);
  }
  q = q.limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('posts').doc(cursor).get();
    if (cursorSnap.exists) {
      const cursorField = sortBy === 'likes' ? (cursorSnap.data()?.counts?.likes ?? 0) : cursorSnap.get('createdAt');
      q = q.startAfter(cursorField, cursorSnap.id);
    }
  }

  const snap = await q.get();
  const contents = snap.docs.map(toContentListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {contents, nextCursor};
});
