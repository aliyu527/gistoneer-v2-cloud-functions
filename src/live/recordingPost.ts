import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {createNotification} from '../notifications/service';

interface RecordingMedia {
  url: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
}

/**
 * Writes a draft posts/{id} doc for a just-finished live recording and
 * notifies the host to review it. Deliberately a small, self-contained
 * writer rather than reusing createPost.ts's full pipeline — a recording
 * post needs none of that function's caption-parsing/mention-resolution/
 * tagging/audio-layer complexity, just the base Post shape it already
 * establishes (see createPost.ts's own ref.set() for the fields this
 * mirrors).
 *
 * audience: 'private' + status: 'draft' is the whole privacy mechanism —
 * deliberately NOT a rules/query change. The existing posts/{id} read rule
 * already allows authorId == auth.uid regardless of audience, and every
 * existing feed/profile query filters on audience == 'public' with no
 * status filter at all — so a private-audience draft is already invisible
 * everywhere except to its own author, with zero changes to that working
 * query code. publishRecordingPost is what flips both fields for real.
 *
 * The deterministic id (`live-${liveId}`) makes this naturally idempotent
 * if the completion webhook ever redelivers.
 */
export async function createDraftPostFromRecording(
  liveId: string,
  hostId: string,
  liveTitle: string,
  liveVisibility: 'public' | 'private',
  media: RecordingMedia,
): Promise<string> {
  const userSnap = await db.collection('users').doc(hostId).get();
  const userData = userSnap.data() ?? {};
  const author: Record<string, string> = {userId: hostId};
  if (userData.username) author.username = userData.username;
  if (userData.displayName) author.displayName = userData.displayName;
  if (userData.photoURL) author.avatarUrl = userData.photoURL;

  const postId = `live-${liveId}`;
  const ref = db.collection('posts').doc(postId);
  await ref.set({
    id: postId,
    authorId: hostId,
    author,
    caption: liveTitle,
    hashtags: [],
    mentions: [],
    media: [
      {
        type: 'video',
        url: media.url,
        mimeType: media.mimeType,
        fileSize: media.fileSize,
        width: media.width,
        height: media.height,
        storageKey: media.storageKey,
      },
    ],
    audience: 'private',
    allowComments: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    status: 'draft',
    counts: {likes: 0, comments: 0, bookmarks: 0, shares: 0},
    // Carried onto the post so publishRecordingPost can default the
    // published audience to match the live's own visibility.
    sourceLiveVisibility: liveVisibility,
  });

  await createNotification({recipientId: hostId, actorId: hostId, type: 'live_recording_ready', postId});
  return postId;
}
