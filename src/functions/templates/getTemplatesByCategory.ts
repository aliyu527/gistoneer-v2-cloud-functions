import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getTemplatesByCategory as getTemplatesByCategoryService} from '../../templates/service';
import type {GistoneerTemplate, Page, TemplateCategory} from '../../templates/types';

const CATEGORIES: readonly TemplateCategory[] = ['cinematic', 'retro', 'travel', 'birthday', 'celebration', 'gistoneer'];

interface GetTemplatesByCategoryRequest {
  category: TemplateCategory;
  cursor?: string;
  limit?: number;
}

export const getTemplatesByCategory = onCall<GetTemplatesByCategoryRequest, Promise<Page<GistoneerTemplate>>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {category, cursor, limit} = request.data ?? {};
    if (!category || !CATEGORIES.includes(category)) {
      throw new HttpsError('invalid-argument', 'Missing or invalid category.');
    }

    try {
      return await getTemplatesByCategoryService(category, {cursor, limit});
    } catch {
      throw new HttpsError('unavailable', "Couldn't load templates. Check your connection and try again.");
    }
  },
);
