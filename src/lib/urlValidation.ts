const ALLOWED_SCHEMES = ['http', 'https'];
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const MAX_URL_LENGTH = 2048;

export type UrlValidationResult = {url: string} | {error: string};

/**
 * Regex-based rather than relying on the URL global (mirrored client-side
 * where Hermes's URL support isn't something to depend on) - same algorithm
 * both places, so client and server never disagree about what's valid.
 * Never trust the client's own check alone: this exact function runs again
 * server-side in createPost before anything is written.
 */
export function normalizeAndValidateUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return {error: 'Please enter a link.'};
  if (trimmed.length > MAX_URL_LENGTH) return {error: 'That link is too long.'};

  const hasScheme = SCHEME_RE.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  const schemeMatch = candidate.match(SCHEME_RE);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
  if (!ALLOWED_SCHEMES.includes(scheme)) {
    return {error: "That link isn't allowed."};
  }

  const hostMatch = candidate.match(/^https?:\/\/([^/\s?#]+)/i);
  const host = hostMatch?.[1];
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host) || !host.includes('.')) {
    return {error: 'Enter a valid link.'};
  }

  return {url: candidate};
}
