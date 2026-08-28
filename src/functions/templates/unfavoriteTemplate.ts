import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {unfavoriteTemplate as unfavoriteTemplateService} from '../../templates/service';

interface UnfavoriteTemplateRequest {
  templateId: string;
}

export const unfavoriteTemplate = onCall<UnfavoriteTemplateRequest, Promise<{favorited: false}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {templateId} = request.data ?? {};
    if (typeof templateId !== 'string' || templateId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing template reference.');
    }

    await unfavoriteTemplateService(request.auth.uid, templateId);
    return {favorited: false};
  },
);
