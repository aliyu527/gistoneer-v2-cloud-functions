import {mockCatalogProvider} from './mockCatalogProvider';
import {firestoreCatalogProvider} from './firestoreCatalogProvider';
import type {SoundProviderAdapter} from './types';

/**
 * The single switch point for the active catalog provider — register a new
 * adapter here and point ACTIVE_PROVIDER_ID at it; nothing else in this
 * module (callables, createPost's publish validation, the client) needs to
 * change. Flipped from 'mock' to 'firestore' once real admin-curated
 * catalog data existed to serve — mockCatalogProvider is kept registered
 * (not deleted) as a documented fallback/dev reference, not because it's
 * still used.
 */
const PROVIDERS: Record<string, SoundProviderAdapter> = {
  mock: mockCatalogProvider,
  firestore: firestoreCatalogProvider,
};

const ACTIVE_PROVIDER_ID = 'firestore';

export function getActiveProvider(): SoundProviderAdapter {
  return PROVIDERS[ACTIVE_PROVIDER_ID];
}
