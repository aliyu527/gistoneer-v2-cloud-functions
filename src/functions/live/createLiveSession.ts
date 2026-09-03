import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {createLiveSession as createLiveSessionService} from '../../live/service';

const MAX_TITLE_LENGTH = 200;
const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];
const SOURCE_TYPES = ['camera', 'external'] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

interface CreateLiveSessionRequest {
  title?: string;
  visibility: Visibility;
  sourceType?: SourceType;
}

export const createLiveSession = onCall<CreateLiveSessionRequest, Promise<{liveId: string}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {title, visibility, sourceType} = request.data ?? {};
    if (!VISIBILITIES.includes(visibility)) {
      throw new HttpsError('invalid-argument', 'Invalid visibility.');
    }
    if (sourceType !== undefined && !SOURCE_TYPES.includes(sourceType)) {
      throw new HttpsError('invalid-argument', 'Invalid source type.');
    }

    const liveId = await createLiveSessionService(request.auth.uid, {
      title: (title ?? '').trim().slice(0, MAX_TITLE_LENGTH),
      visibility,
      sourceType,
    });
    return {liveId};
  },
);
