import {getActiveProvider} from './providerRegistry';
import type {GistoneerSound, Page, PageParams} from './types';

/**
 * Thin functions over the active provider — imported directly by both the
 * callables (functions/src/functions/sounds/*) and createPost.ts's
 * publish-time validation. Not a second implementation of anything; just
 * the one place that knows which provider is active.
 */
export async function searchSounds(query: string, params?: PageParams): Promise<Page<GistoneerSound>> {
  return getActiveProvider().search(query, params);
}

export async function getSoundDetail(providerTrackId: string): Promise<GistoneerSound | null> {
  return getActiveProvider().getTrack(providerTrackId);
}

export async function getCatalogHome(): Promise<{
  featured: GistoneerSound[];
  trending: GistoneerSound[];
  popular: GistoneerSound[];
  genres: {id: string; label: string}[];
}> {
  const provider = getActiveProvider();
  const [featured, trending, popular, genres] = await Promise.all([
    provider.getFeatured({limit: 10}),
    provider.getTrending({limit: 10}),
    provider.getPopular({limit: 10}),
    provider.getCategories(),
  ]);
  return {featured: featured.items, trending: trending.items, popular: popular.items, genres};
}

export async function getSoundsByGenre(categoryId: string, params?: PageParams): Promise<Page<GistoneerSound>> {
  return getActiveProvider().getByCategory(categoryId, params);
}
