import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';

const TOP_CONTENT_LIMIT = 5;

export interface TopContentItem {
  id: string;
  caption: string;
  authorName: string;
  likes: number;
  comments: number;
}

interface TopContentRequest {
  /** Additive, defaults to the original hardcoded 5 — the Dashboard's existing no-args call site is unaffected. Capped at 20 to keep this a bounded top-N read, never a large scan. */
  limit?: number;
}

interface TopContentResponse {
  items: TopContentItem[];
}

/**
 * Published + public only — never surfaces a private/followers-only post's
 * content to an admin without a stronger reason than "it's popular."
 * Sort is fixed to counts.likes (the only ranking with a deployed index —
 * `posts(status, audience, counts.likes desc)`; a comments-sort would need
 * a new composite index, which this module's plan explicitly avoids
 * adding). `limit` is the one additive param, for Module 11's Content
 * Analytics drill-down wanting more than the Dashboard's 5.
 */
export const getTopContent = onCall<TopContentRequest, Promise<TopContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const requestedLimit = request.data?.limit;
  const limit = requestedLimit && requestedLimit > 0 ? Math.min(requestedLimit, 20) : TOP_CONTENT_LIMIT;

  const snap = await db
    .collection('posts')
    .where('status', '==', 'published')
    .where('audience', '==', 'public')
    .orderBy('counts.likes', 'desc')
    .limit(limit)
    .get();

  const items: TopContentItem[] = snap.docs.map((doc) => {
    const data = doc.data();
    const author = (data.author as {displayName?: string; username?: string}) ?? {};
    return {
      id: doc.id,
      caption: (data.caption as string) ?? '',
      authorName: author.displayName || author.username || 'Gistoneer user',
      likes: data.counts?.likes ?? 0,
      comments: data.counts?.comments ?? 0,
    };
  });

  return {items};
});
