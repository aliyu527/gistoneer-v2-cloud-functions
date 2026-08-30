const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

/**
 * Provider-independent page-size cap. The mock catalog/template providers
 * already clamp internally, but that guarantee must not depend on which
 * provider is active — a future real provider adapter could omit it,
 * turning an unbounded client-supplied limit into a real cost/DoS risk
 * against a paid external API.
 */
export function clampLimit(value: unknown, max: number = MAX_PAGE_LIMIT, fallback: number = DEFAULT_PAGE_LIMIT): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}
