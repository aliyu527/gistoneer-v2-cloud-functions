import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {searchTemplates as searchTemplatesService} from '../../templates/service';
import {clampLimit} from '../../lib/pagination';
import type {GistoneerTemplate, Page} from '../../templates/types';

interface SearchTemplatesRequest {
  query: string;
  cursor?: string;
  limit?: number;
}

const MAX_QUERY_LENGTH = 200;

export const searchTemplates = onCall<SearchTemplatesRequest, Promise<Page<GistoneerTemplate>>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {query, cursor, limit} = request.data ?? {};
    if (typeof query !== 'string' || query.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing search query.');
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new HttpsError('invalid-argument', 'Search query is too long.');
    }

    try {
      return await searchTemplatesService(query, {cursor, limit: clampLimit(limit)});
    } catch {
      throw new HttpsError('unavailable', "Couldn't load templates. Check your connection and try again.");
    }
  },
);
