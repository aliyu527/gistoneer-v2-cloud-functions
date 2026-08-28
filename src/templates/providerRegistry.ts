import {mockTemplateProvider} from './mockTemplateProvider';
import type {TemplateProviderAdapter} from './types';

/** One active provider today (mock — no real template marketplace exists). Mirrors sounds/providerRegistry.ts exactly. */
const PROVIDERS: Record<string, TemplateProviderAdapter> = {
  mock: mockTemplateProvider,
};

const ACTIVE_PROVIDER_ID = 'mock';

export function getActiveProvider(): TemplateProviderAdapter {
  return PROVIDERS[ACTIVE_PROVIDER_ID];
}
