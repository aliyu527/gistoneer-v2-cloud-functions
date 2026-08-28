import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {getCatalogHome} from '../../templates/service';
import type {GistoneerTemplate, TemplateCategory} from '../../templates/types';

interface CatalogHomeResponse {
  featured: GistoneerTemplate[];
  trending: GistoneerTemplate[];
  categories: {id: TemplateCategory; label: string}[];
}

export const getTemplateCatalogHome = onCall<unknown, Promise<CatalogHomeResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    try {
      return await getCatalogHome();
    } catch {
      throw new HttpsError('unavailable', "Couldn't load templates. Check your connection and try again.");
    }
  },
);
