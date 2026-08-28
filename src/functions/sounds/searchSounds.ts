import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {searchSounds as searchSoundsService} from '../../sounds/service';
import type {GistoneerSound, Page} from '../../sounds/types';

interface SearchSoundsRequest {
  query: string;
  cursor?: string;
  limit?: number;
}

const MAX_QUERY_LENGTH = 200;

/** Backend proxy for catalog search (spec §47/§126) — the client never calls a provider directly. */
export const searchSounds = onCall<SearchSoundsRequest, Promise<Page<GistoneerSound>>>(
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
      return await searchSoundsService(query, {cursor, limit});
    } catch {
      throw new HttpsError('unavailable', "Couldn't load sounds. Check your connection and try again.");
    }
  },
);
