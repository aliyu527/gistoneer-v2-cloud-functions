/**
 * Extracted from adminListContent.ts when that function was migrated to a
 * direct Firestore read (admin panel Cloud Run cost-reduction migration) —
 * adminSearchContent.ts, adminGetContentDetail.ts, adminGetPostsUsingSound.ts,
 * and restoreContent.ts still need this shape/helper, so it lives here now
 * instead of being deleted along with the list callable itself.
 */
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
