/**
 * A Firebase uid is a string; Agora's numeric uid must be a positive
 * 32-bit integer. Derived deterministically (not client-supplied) so the
 * same person always maps to the same in-channel uid and nobody can spoof
 * another user's Agora identity by choosing their own number. FNV-1a is
 * plenty for this — collision risk is not a security boundary here (worst
 * case two users render as the same remote tile), it's just a stable,
 * cheap, dependency-free hash.
 *
 * Its own leaf module (no other imports) because both token.ts and
 * service.ts need it, and token.ts already imports joinAudience from
 * service.ts — importing this the other way would be a require cycle.
 */
export function agoraUidFor(firebaseUid: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < firebaseUid.length; i++) {
    hash ^= firebaseUid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Keep it in 1..(2^31-1) — comfortably inside Agora's 1..(2^32-1) uid
  // range, and avoids the sign bit entirely (Agora's own JS type is a
  // plain `number`, so staying under 2^31 sidesteps any signed/unsigned
  // ambiguity in how the native SDK marshals it).
  return (hash >>> 0) % 0x7fffffff || 1;
}
