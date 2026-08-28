import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getTemplateDetail as getTemplateDetailService, isFavorited} from '../../templates/service';
import type {GistoneerTemplate} from '../../templates/types';

interface GetTemplateDetailRequest {
  templateId: string;
}

interface GetTemplateDetailResponse {
  template: GistoneerTemplate | null;
  isFavorited: boolean;
}

export const getTemplateDetail = onCall<GetTemplateDetailRequest, Promise<GetTemplateDetailResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {templateId} = request.data ?? {};
    if (typeof templateId !== 'string' || templateId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing template reference.');
    }

    try {
      const [template, favorited] = await Promise.all([
        getTemplateDetailService(templateId),
        isFavorited(request.auth.uid, templateId),
      ]);
      return {template, isFavorited: favorited};
    } catch {
      throw new HttpsError('unavailable', "Couldn't load this template. Check your connection and try again.");
    }
  },
);
