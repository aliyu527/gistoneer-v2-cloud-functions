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

interface TopContentResponse {
  items: TopContentItem[];
}

/** Published + public only — never surfaces a private/followers-only post's content to an admin without a stronger reason than "it's popular." */
export const getTopContent = onCall<undefined, Promise<TopContentResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.');
  }

  const snap = await db
    .collection('posts')
    .where('status', '==', 'published')
    .where('audience', '==', 'public')
    .orderBy('counts.likes', 'desc')
    .limit(TOP_CONTENT_LIMIT)
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
