import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminLiveSessionListItem} from './adminListLiveSessions';

interface LiveSpeakerInfo {
  uid: string;
  agoraUid: number;
  displayName: string;
  photoURL: string | null;
  audioMuted: boolean;
  videoMuted: boolean;
}

interface RecordingInfo {
  status: 'recording' | 'stopping' | 'uploading' | 'ready' | 'failed';
  progress: number | null;
  error: string | null;
  postUrl: string | null;
  postStatus: 'published' | 'draft' | null;
}

export interface AdminLiveSessionDetail extends AdminLiveSessionListItem {
  agoraChannelName: string;
  hostAgoraUid: number | null;
  externalIngestUid: number | null;
  activeSpeakers: LiveSpeakerInfo[];
  viewerPreviewCount: number;
  hostStatus: 'active' | 'suspended' | null;
  recording: RecordingInfo | null;
  updatedAt: string | null;
}

interface AdminGetLiveSessionDetailRequest {
  liveId: string;
}

/**
 * `hostName`/`hostAvatarUrl`/`activeSpeakers` are already denormalized on
 * the session doc. Recording is resolved via a direct posts/{recordingPostId}
 * read (NOT adminGetContentDetail, which requires status=='published' and
 * would 404 a draft recording post) — a recording stays a draft until the
 * host chooses to publish it (publishRecordingPost.ts, untouched).
 */
export const adminGetLiveSessionDetail = onCall<AdminGetLiveSessionDetailRequest, Promise<AdminLiveSessionDetail>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'live.read');

  const liveId = request.data?.liveId;
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing liveId.');
  }

  const snap = await db.collection('liveSessions').doc(liveId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This live session could not be found.');
  }
  const data = snap.data()!;
  const hostId = (data.hostId as string) ?? '';
  const recordingPostId = data.recordingPostId as string | undefined;

  const [hostSnap, recordingPostSnap] = await Promise.all([
    db.collection('users').doc(hostId).get(),
    recordingPostId ? db.collection('posts').doc(recordingPostId).get() : Promise.resolve(null),
  ]);

  let hostStatus: AdminLiveSessionDetail['hostStatus'] = null;
  if (hostSnap.exists) {
    hostStatus = (hostSnap.data()!.status as 'active' | 'suspended') ?? 'active';
  }

  let recording: RecordingInfo | null = null;
  const recordingStatus = data.recordingStatus as RecordingInfo['status'] | undefined;
  if (recordingStatus) {
    let postUrl: string | null = null;
    let postStatus: RecordingInfo['postStatus'] = null;
    if (recordingPostSnap && recordingPostSnap.exists) {
      const postData = recordingPostSnap.data()!;
      const media = Array.isArray(postData.media) ? postData.media : [];
      postUrl = (media[0]?.url as string) ?? null;
      postStatus = (postData.status as 'published' | 'draft') ?? null;
    }
    recording = {
      status: recordingStatus,
      progress: typeof data.recordingProgress === 'number' ? data.recordingProgress : null,
      error: (data.recordingError as string) ?? null,
      postUrl,
      postStatus,
    };
  }

  const activeSpeakers = Array.isArray(data.activeSpeakers) ? (data.activeSpeakers as Record<string, unknown>[]) : [];

  return {
    id: snap.id,
    hostId,
    hostName: (data.hostName as string) ?? 'Gistoneer user',
    hostAvatarUrl: (data.hostAvatarUrl as string) ?? null,
    title: (data.title as string) ?? '',
    visibility: (data.visibility as AdminLiveSessionDetail['visibility']) ?? 'public',
    sourceType: (data.sourceType as AdminLiveSessionDetail['sourceType']) ?? 'camera',
    status: (data.status as AdminLiveSessionDetail['status']) ?? 'ended',
    viewerCount: typeof data.viewerCount === 'number' ? data.viewerCount : 0,
    recordingStatus: recordingStatus ?? null,
    startedAt: data.startedAt?.toDate?.().toISOString() ?? null,
    endedAt: data.endedAt?.toDate?.().toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    agoraChannelName: (data.agoraChannelName as string) ?? snap.id,
    hostAgoraUid: typeof data.hostAgoraUid === 'number' ? data.hostAgoraUid : null,
    externalIngestUid: typeof data.externalIngestUid === 'number' ? data.externalIngestUid : null,
    activeSpeakers: activeSpeakers.map((speaker) => ({
      uid: (speaker.uid as string) ?? '',
      agoraUid: typeof speaker.agoraUid === 'number' ? speaker.agoraUid : 0,
      displayName: (speaker.displayName as string) ?? 'Gistoneer user',
      photoURL: (speaker.photoURL as string) ?? null,
      audioMuted: Boolean(speaker.audioMuted),
      videoMuted: Boolean(speaker.videoMuted),
    })),
    viewerPreviewCount: Array.isArray(data.viewers) ? data.viewers.length : 0,
    hostStatus,
    recording,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
  };
});
