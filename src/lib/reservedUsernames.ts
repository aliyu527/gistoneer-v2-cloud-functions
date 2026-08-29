// Usernames the product/brand can't let a user claim. Extend as needed —
// this list is intentionally small and focused, not exhaustive profanity
// filtering (that's a separate, product-level concern).
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'support',
  'help',
  'gistoneer',
  'official',
  'moderator',
  'mod',
  'system',
  'security',
  'about',
  'settings',
  'null',
  'undefined',
  'api',
  'www',
]);

export function isReservedUsername(usernameLower: string): boolean {
  return RESERVED_USERNAMES.has(usernameLower);
}
