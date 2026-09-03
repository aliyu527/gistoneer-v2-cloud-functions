import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';

const MAX_CAPTION_LENGTH = 2000; // matches createPost.ts's own cap
const AUDIENCES = ['public', 'followers', 'private'] as const;
type Audience = (typeof AUDIENCES)[number];

interface PublishRecordingPostRequest {
  postId: string;
  caption?: string;
  audience?: Audience;
}

/**
 * Publishes a draft post created by createDraftPostFromRecording (see
 * live/recordingPost.ts) — the host's explicit "yes, post this" step after
 * reviewing it. Only ever operates on status:'draft' posts (defense against
 * misuse on a real, already-published post via the same callable).
 * createdAt is re-stamped at actual publish time rather than kept from
 * whenever the recording finished uploading, so it sorts correctly into the
 * feed the moment it goes live instead of appearing "already old".
 */
export const publishRecordingPost = onCall<PublishRecordingPostRequest, Promise<{status: 'published'}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {postId, caption, audience} = request.data ?? {};
    if (typeof postId !== 'string' || postId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing post reference.');
    }
    if (audience !== undefined && !AUDIENCES.includes(audience)) {
      throw new HttpsError('invalid-argument', 'Invalid audience.');
    }

    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', "We couldn't find that post.");
    }
    const data = snap.data()!;
    if (data.authorId !== request.auth.uid) {
      throw new HttpsError('permission-denied', "This isn't your post.");
    }
    if (data.status !== 'draft') {
      throw new HttpsError('failed-precondition', 'This post has already been published.');
    }

    await ref.update({
      status: 'published',
      audience: audience ?? (data.sourceLiveVisibility === 'private' ? 'private' : 'public'),
      ...(typeof caption === 'string' ? {caption: caption.trim().slice(0, MAX_CAPTION_LENGTH)} : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {status: 'published'};
  },
);
