import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {favoriteTemplate as favoriteTemplateService} from '../../templates/service';

interface FavoriteTemplateRequest {
  templateId: string;
}

export const favoriteTemplate = onCall<FavoriteTemplateRequest, Promise<{favorited: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {templateId} = request.data ?? {};
    if (typeof templateId !== 'string' || templateId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing template reference.');
    }

    await favoriteTemplateService(request.auth.uid, templateId);
    return {favorited: true};
  },
);
