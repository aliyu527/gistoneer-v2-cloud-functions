/**
 * E.164 check — the client (react-native-international-phone-number) is
 * responsible for producing a correctly formatted number; this is a defensive
 * re-check, not the primary validation.
 */
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  return E164_RE.test(trimmed) ? trimmed : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

// Lowercase letters, digits, underscore, 3-20 chars — matches the client-side
// rule in Services/Validation/username.ts. Keep the two in sync.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  return USERNAME_RE.test(lower) ? lower : null;
}

// Letters, digits, underscore only, 1-50 chars — hashtags may contain
// unicode letters (e.g. accented characters), so this only strips characters
// that would break simple string matching later rather than restricting to ASCII.
const HASHTAG_RE = /^[\p{L}\p{N}_]{1,50}$/u;

export function normalizeHashtag(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  return HASHTAG_RE.test(lower) ? lower : null;
}
