import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getComments, type PostComment} from '../../posts/comments';
import {requireActiveAdmin} from './requireActiveAdmin';

interface AdminGetContentCommentsRequest {
  postId: string;
}

interface AdminGetContentCommentsResponse {
  comments: PostComment[];
}

const ADMIN_COMMENTS_LIMIT = 50;

/**
 * Reuses the existing getComments() service (functions/src/posts/comments.ts)
 * — same top-level-only, newest-first query the mobile app's own getComments
 * callable uses, already indexed. Comments are fully server-opaque by rule
 * (`allow read, write: if false`), so this is the only way an admin can see
 * them. A single most-recent-50 fetch, no further pagination — a contextual
 * view, not the full comment-moderation system the spec explicitly scopes
 * out of this module.
 */
export const adminGetContentComments = onCall<AdminGetContentCommentsRequest, Promise<AdminGetContentCommentsResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    await requireActiveAdmin(request, 'content.read');

    const postId = request.data?.postId;
    if (typeof postId !== 'string' || postId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing postId.');
    }

    const comments = await getComments(postId, ADMIN_COMMENTS_LIMIT);
    return {comments};
  },
);
