import {mockCatalogProvider} from './mockCatalogProvider';
import type {SoundProviderAdapter} from './types';

/**
 * One active provider today (mock — no real provider is configured; see
 * Module 5's plan). This is the single switch point for a future real
 * adapter: register it here, point ACTIVE_PROVIDER_ID at it, and nothing
 * else in this module (callables, createPost's publish validation, the
 * client) needs to change.
 */
const PROVIDERS: Record<string, SoundProviderAdapter> = {
  mock: mockCatalogProvider,
};

const ACTIVE_PROVIDER_ID = 'mock';

export function getActiveProvider(): SoundProviderAdapter {
  return PROVIDERS[ACTIVE_PROVIDER_ID];
}
