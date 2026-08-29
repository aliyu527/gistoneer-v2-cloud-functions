/**
 * Firebase Authentication's password provider is inherently email-based —
 * there is no native "phone + password" sign-in method. Rather than
 * reimplementing password storage/hashing ourselves (which the product spec
 * explicitly wants to avoid — "Firebase Authentication must manage
 * passwords"), phone accounts get a deterministic, non-deliverable synthetic
 * email alias set on the same Firebase Auth user record. Password sign-in
 * for a phone account is then just `signInWithEmailAndPassword(alias, pw)`,
 * resolving to the same uid.
 *
 * This is a pure, deterministic function — mirrored identically on the
 * client (Services/Auth/phoneAuth.ts) so both sides compute the same alias
 * from the same E.164 number without any server round-trip.
 */
export function phoneAliasEmail(e164Phone: string): string {
  const digits = e164Phone.replace(/^\+/, '');
  return `${digits}@phone.gistoneer.internal`;
}
