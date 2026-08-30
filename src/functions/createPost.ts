import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {buildPublicUrl} from '../lib/s3';
import {normalizeHashtag, normalizeUsername} from '../lib/normalize';
import {normalizeAndValidateUrl} from '../lib/urlValidation';
import {verifyExistingUserIds} from '../lib/userVerification';
import {getSoundDetail} from '../sounds/service';

const MAX_CAPTION_LENGTH = 2200; // matches the client's own TextInput maxLength
const MAX_MEDIA_ITEMS = 10; // mirrors the client's MEDIA_LIMITS post cap
const MAX_LOCATION_NAME_LENGTH = 100;
const MAX_TAGGED_USERS = 20;
const AUDIENCES = ['public', 'followers', 'private'] as const;
type Audience = (typeof AUDIENCES)[number];
const SOUND_SOURCES = ['ORIGINAL', 'DEVICE', 'LOCAL', 'CATALOG', 'RECORDING', 'LIBRARY'] as const;
type SoundSource = (typeof SOUND_SOURCES)[number];
const AUDIO_LAYER_TYPES = ['music', 'voiceover', 'soundEffect'] as const;
type AudioLayerType = (typeof AUDIO_LAYER_TYPES)[number];
const DUCKING_LEVELS = ['off', 'low', 'medium', 'strong'] as const;
type DuckingLevel = (typeof DUCKING_LEVELS)[number];
const MAX_SOUND_TITLE_LENGTH = 200;
const MAX_AUDIO_LAYERS = 12;

interface CreatePostMediaInput {
  uploadId: string;
  thumbnailUploadId?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface CreatePostAudioLayerInput {
  type?: AudioLayerType;
  trackId?: string;
  source?: SoundSource;
  title?: string;
  artist?: string;
  provider?: string;
  providerTrackId?: string;
  startTimeMs?: number;
  startOffsetMs?: number;
  durationMs?: number;
  volume?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  deviceUploadId?: string;
}

interface CreatePostRequest {
  caption?: string;
  media: CreatePostMediaInput[];
  audience: Audience;
  allowComments: boolean;
  location?: {name?: string};
  /** Idempotency key from the client's upload queue — stable across every retry of the same publish attempt. */
  clientPostId?: string;
  layers?: CreatePostAudioLayerInput[];
  duckingLevel?: DuckingLevel;
  taggedUserIds?: string[];
  link?: {url?: string};
}

interface PostAudioLayer {
  type: AudioLayerType;
  trackId: string;
  source: SoundSource;
  title: string;
  artist?: string;
  provider?: string;
  providerTrackId?: string;
  startTimeMs: number;
  startOffsetMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  /** Public URL, resolved server-side from the verified upload — never the client-supplied uploadId directly. */
  deviceAudioUrl?: string;
  /** Only present for source: 'CATALOG' — the server's own trusted license/attribution, never the client's copy. */
  licenseStatus?: string;
  attributionRequired?: boolean;
  attributionText?: string;
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
    mediaType: 'image' | 'video' | 'audio';
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

    // Idempotency: the client's upload queue sends the same clientPostId on
    // every retry of a given publish attempt. If a doc with that id already
    // exists and belongs to this user, a previous call already succeeded —
    // return that result instead of writing a duplicate post (mirrors
    // confirmMediaUpload's own early-return-if-already-done pattern). No
    // clientPostId (any other caller) falls back to today's auto-ID write.
    const clientPostId =
      typeof data.clientPostId === 'string' && data.clientPostId.length > 0 && data.clientPostId.length <= 200
        ? data.clientPostId
        : undefined;
    if (clientPostId) {
      const existing = await db.collection('posts').doc(clientPostId).get();
      if (existing.exists) {
        const existingData = existing.data()!;
        if (existingData.authorId !== uid) {
          // Practically unreachable (clientPostId is a random client-generated
          // string) — but if it ever collided with someone else's post, don't
          // confirm that to the caller. Same "not-found" posture confirmMediaUpload
          // uses for a record that exists but belongs to someone else.
          throw new HttpsError('invalid-argument', 'Something went wrong. Please try again.');
        }
        return {postId: existing.id};
      }
    }

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

    const layers: PostAudioLayer[] = [];
    if (Array.isArray(data.layers)) {
      if (data.layers.length > MAX_AUDIO_LAYERS) {
        throw new HttpsError('invalid-argument', `Posts can include at most ${MAX_AUDIO_LAYERS} audio clips.`);
      }
      for (const s of data.layers) {
        const structurallyValid =
          s.type &&
          AUDIO_LAYER_TYPES.includes(s.type) &&
          typeof s.trackId === 'string' &&
          s.trackId.length > 0 &&
          s.source &&
          SOUND_SOURCES.includes(s.source) &&
          typeof s.title === 'string' &&
          s.title.length > 0 &&
          s.title.length <= MAX_SOUND_TITLE_LENGTH &&
          Number.isFinite(s.startTimeMs) &&
          (s.startTimeMs ?? -1) >= 0 &&
          Number.isFinite(s.startOffsetMs) &&
          (s.startOffsetMs ?? -1) >= 0 &&
          Number.isFinite(s.durationMs) &&
          (s.durationMs ?? 0) > 0 &&
          Number.isFinite(s.volume);
        // An invalid/incomplete layer is silently dropped rather than
        // failing the whole publish — it's metadata enrichment, not a
        // required field (mirrors thumbnailUploadId's own graceful
        // degradation above). A CATALOG layer that fails the license check
        // below throws instead, per spec §74's explicit "do not silently publish."
        if (!structurallyValid) continue;

        let deviceAudioUrl: string | undefined;
        if (s.deviceUploadId) {
          const audioUpload = await verifyUpload(s.deviceUploadId, uid);
          if (audioUpload && audioUpload.mediaType === 'audio') {
            deviceAudioUrl = buildPublicUrl(audioUpload.storageKey, audioUpload.bucket, audioUpload.region);
          }
        }

        let layer: PostAudioLayer = {
          type: s.type!,
          trackId: s.trackId!,
          source: s.source!,
          title: s.title!,
          ...(s.artist ? {artist: s.artist} : {}),
          ...(s.provider ? {provider: s.provider} : {}),
          ...(s.providerTrackId ? {providerTrackId: s.providerTrackId} : {}),
          startTimeMs: s.startTimeMs!,
          startOffsetMs: s.startOffsetMs!,
          durationMs: s.durationMs!,
          volume: Math.max(0, Math.min(1, s.volume!)),
          muted: s.muted === true,
          fadeInMs: Number.isFinite(s.fadeInMs) ? Math.max(0, s.fadeInMs!) : 0,
          fadeOutMs: Number.isFinite(s.fadeOutMs) ? Math.max(0, s.fadeOutMs!) : 0,
          ...(deviceAudioUrl ? {deviceAudioUrl} : {}),
        };

        // A catalog layer's rights are server-trusted, never the client's
        // claim (spec §9/§73-74) — re-look-up the track and reject the
        // whole publish (not a silent drop) if it's missing, unavailable,
        // restricted, or territory-restricted. On success, overwrite title/
        // artist/attribution with the server's own record rather than
        // whatever the client sent.
        if (layer.source === 'CATALOG' && layer.providerTrackId) {
          const track = await getSoundDetail(layer.providerTrackId);
          const blocked =
            !track ||
            !track.isAvailable ||
            track.license.status === 'unavailable' ||
            track.license.status === 'territoryRestricted' ||
            track.license.status === 'restricted';
          if (blocked) {
            throw new HttpsError('failed-precondition', "This sound can't be used for this post.");
          }
          layer = {
            type: layer.type,
            trackId: layer.trackId,
            source: layer.source,
            title: track.title,
            ...(track.artist ? {artist: track.artist} : {}),
            ...(layer.provider ? {provider: layer.provider} : {}),
            ...(layer.providerTrackId ? {providerTrackId: layer.providerTrackId} : {}),
            startTimeMs: layer.startTimeMs,
            startOffsetMs: layer.startOffsetMs,
            durationMs: layer.durationMs,
            volume: layer.volume,
            muted: layer.muted,
            fadeInMs: layer.fadeInMs,
            fadeOutMs: layer.fadeOutMs,
            licenseStatus: track.license.status,
            ...(track.license.attributionRequired ? {attributionRequired: true} : {}),
            ...(track.license.attributionText ? {attributionText: track.license.attributionText} : {}),
          };
        }

        // A LIBRARY layer references the caller's own uploaded sound
        // (Music Studio Module 4) — same non-trust posture as CATALOG above:
        // re-look-up the record server-side and overwrite title/artist/url
        // from it, rather than believing whatever the client sent. trackId
        // is the sounds/{soundId} doc id (see Services/Music/soundToTrack.ts
        // on the client — a LIBRARY SoundTrack.id is always the sound's own
        // Firestore id).
        if (layer.source === 'LIBRARY') {
          const soundSnap = await db.collection('sounds').doc(layer.trackId).get();
          if (!soundSnap.exists || soundSnap.data()!.ownerId !== uid) {
            throw new HttpsError('failed-precondition', "This sound can't be used for this post.");
          }
          const sound = soundSnap.data()!;
          layer = {
            type: layer.type,
            trackId: layer.trackId,
            source: layer.source,
            title: sound.title,
            ...(sound.artist ? {artist: sound.artist} : {}),
            startTimeMs: layer.startTimeMs,
            startOffsetMs: layer.startOffsetMs,
            durationMs: layer.durationMs,
            volume: layer.volume,
            muted: layer.muted,
            fadeInMs: layer.fadeInMs,
            fadeOutMs: layer.fadeOutMs,
            // Reuses the same field DEVICE/RECORDING layers store their
            // resolved URL in — same purpose (a hosted, playable URL for a
            // non-catalog layer), not a device-originated file specifically.
            deviceAudioUrl: sound.audioUrl,
          };
        }

        layers.push(layer);
      }
    }

    const duckingLevel: DuckingLevel = data.duckingLevel && DUCKING_LEVELS.includes(data.duckingLevel) ? data.duckingLevel : 'off';

    const hashtags = [...new Set(extractTokens(caption, /#([\p{L}\p{N}_]+)/gu).map(normalizeHashtag).filter((h): h is string => h !== null))];

    const mentionCandidates = [...new Set(extractTokens(caption, /@(\w+)/g).map(normalizeUsername).filter((m): m is string => m !== null))];
    const mentionDocs = await Promise.all(mentionCandidates.map((u) => db.collection('usernames').doc(u).get()));
    const mentions = [...new Set(mentionDocs.filter((d) => d.exists).map((d) => d.data()!.uid as string))];

    let location: {name: string} | undefined;
    const locationName = data.location?.name?.trim();
    if (locationName) {
      location = {name: locationName.slice(0, MAX_LOCATION_NAME_LENGTH)};
    }

    let link: {url: string} | undefined;
    if (data.link?.url) {
      const validated = normalizeAndValidateUrl(data.link.url);
      if ('error' in validated) {
        throw new HttpsError('invalid-argument', validated.error);
      }
      link = {url: validated.url};
    }

    // Deleted/unavailable users are silently dropped rather than failing
    // the publish — same posture as unresolvable @mentions below.
    let taggedUsers: {userId: string}[] = [];
    if (Array.isArray(data.taggedUserIds) && data.taggedUserIds.length > 0) {
      const candidates = data.taggedUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_TAGGED_USERS);
      const verified = await verifyExistingUserIds(candidates);
      taggedUsers = verified.map((userId) => ({userId}));
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data() ?? {};
    const author: Record<string, string> = {userId: uid};
    if (userData.username) author.username = userData.username;
    if (userData.displayName) author.displayName = userData.displayName;
    if (userData.photoURL) author.avatarUrl = userData.photoURL;

    const ref = clientPostId ? db.collection('posts').doc(clientPostId) : db.collection('posts').doc();
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
      ...(link ? {link} : {}),
      ...(taggedUsers.length > 0 ? {taggedUsers} : {}),
      ...(layers.length > 0 ? {layers, duckingLevel} : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      status: 'published',
      counts: {likes: 0, comments: 0, bookmarks: 0, shares: 0},
    });

    return {postId: ref.id};
  },
);
