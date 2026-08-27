import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl} from '../lib/s3';
import {normalizeHashtag, normalizeUsername} from '../lib/normalize';

const MAX_CAPTION_LENGTH = 2200; // matches the client's own TextInput maxLength
const MAX_MEDIA_ITEMS = 10; // mirrors the client's MEDIA_LIMITS post cap
const MAX_LOCATION_NAME_LENGTH = 100;
const AUDIENCES = ['public', 'followers', 'private'] as const;
type Audience = (typeof AUDIENCES)[number];

interface CreatePostMediaInput {
  uploadId: string;
  thumbnailUploadId?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface CreatePostRequest {
  caption?: string;
  media: CreatePostMediaInput[];
  audience: Audience;
  allowComments: boolean;
  location?: {name?: string};
}

interface PostMedia {
  type: 'photo' | 'video';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType: string;
  fileSize: number;
  storageKey: string;
}

interface CreatePostResponse {
  postId: string;
}

/** Looks up a mediaUploads record and verifies it belongs to this user and finished uploading — never trusts client-supplied storageKey/url/bucket directly. */
async function verifyUpload(uploadId: string, uid: string) {
  const snap = await db.collection('mediaUploads').doc(uploadId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (data.uid !== uid || data.status !== 'uploaded') return null;
  return data as {
    mediaType: 'image' | 'video';
    mimeType: string;
    fileSize: number;
    storageKey: string;
    bucket: string;
    region: string;
  };
}

function extractTokens(caption: string, pattern: RegExp): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(caption)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * Publishes a post: validates input, re-verifies every referenced media
 * upload server-side (the client only ever sends uploadIds, never raw
 * URLs/keys), resolves @mentions against real accounts, reads the author
 * snapshot from the caller's own profile, and writes posts/{postId} via the
 * Admin SDK — mirroring createMediaUploadUrl/confirmMediaUpload's exact
 * "client never writes Firestore directly" posture.
 */
export const createPost = onCall<CreatePostRequest, Promise<CreatePostResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const data = request.data ?? ({} as CreatePostRequest);

    const caption = (data.caption ?? '').trim();
    if (caption.length > MAX_CAPTION_LENGTH) {
      throw new HttpsError('invalid-argument', `Captions can be at most ${MAX_CAPTION_LENGTH} characters.`);
    }

    if (!Array.isArray(data.media) || data.media.length === 0) {
      throw new HttpsError('invalid-argument', 'Add at least one photo or video to publish.');
    }
    if (data.media.length > MAX_MEDIA_ITEMS) {
      throw new HttpsError('invalid-argument', `Posts can include at most ${MAX_MEDIA_ITEMS} media items.`);
    }

    if (!AUDIENCES.includes(data.audience)) {
      throw new HttpsError('invalid-argument', 'Choose who can see this post.');
    }
    if (typeof data.allowComments !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Missing comments setting.');
    }

    const media: PostMedia[] = [];
    for (const item of data.media) {
      if (!item?.uploadId || typeof item.uploadId !== 'string') {
        throw new HttpsError('invalid-argument', 'One of your media items is missing.');
      }
      const upload = await verifyUpload(item.uploadId, uid);
      if (!upload) {
        throw new HttpsError(
          'failed-precondition',
          "One of your media items hasn't finished uploading. Please try again.",
        );
      }

      let thumbnailUrl: string | undefined;
      if (item.thumbnailUploadId) {
        const thumbUpload = await verifyUpload(item.thumbnailUploadId, uid);
        if (thumbUpload) {
          thumbnailUrl = buildPublicUrl(thumbUpload.storageKey, thumbUpload.bucket, thumbUpload.region);
        }
      }

      media.push({
        type: upload.mediaType === 'video' ? 'video' : 'photo',
        url: buildPublicUrl(upload.storageKey, upload.bucket, upload.region),
        ...(thumbnailUrl ? {thumbnailUrl} : {}),
        ...(typeof item.width === 'number' ? {width: item.width} : {}),
        ...(typeof item.height === 'number' ? {height: item.height} : {}),
        ...(typeof item.duration === 'number' ? {duration: item.duration} : {}),
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        storageKey: upload.storageKey,
      });
    }

    const hashtags = [...new Set(extractTokens(caption, /#([\p{L}\p{N}_]+)/gu).map(normalizeHashtag).filter((h): h is string => h !== null))];

    const mentionCandidates = [...new Set(extractTokens(caption, /@(\w+)/g).map(normalizeUsername).filter((m): m is string => m !== null))];
    const mentionDocs = await Promise.all(mentionCandidates.map((u) => db.collection('usernames').doc(u).get()));
    const mentions = [...new Set(mentionDocs.filter((d) => d.exists).map((d) => d.data()!.uid as string))];

    let location: {name: string} | undefined;
    const locationName = data.location?.name?.trim();
    if (locationName) {
      location = {name: locationName.slice(0, MAX_LOCATION_NAME_LENGTH)};
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data() ?? {};
    const author: Record<string, string> = {userId: uid};
    if (userData.username) author.username = userData.username;
    if (userData.displayName) author.displayName = userData.displayName;
    if (userData.photoURL) author.avatarUrl = userData.photoURL;

    const ref = db.collection('posts').doc();
    await ref.set({
      id: ref.id,
      authorId: uid,
      author,
      caption,
      hashtags,
      mentions,
      media,
      audience: data.audience,
      allowComments: data.allowComments,
      ...(location ? {location} : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      status: 'published',
      counts: {likes: 0, comments: 0, bookmarks: 0, shares: 0},
    });

    return {postId: ref.id};
  },
);
