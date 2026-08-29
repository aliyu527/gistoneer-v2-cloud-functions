import {createHmac, timingSafeEqual} from 'crypto';

const TOLERANCE_SECONDS = 5 * 60; // reject requests signed more than 5 minutes off "now"

/**
 * Resend delivers webhooks signed the same way Svix does. Verifying this is
 * what stops anyone on the internet from POSTing fake "email bounced"/
 * "email complained" events at the endpoint — without it, the webhook is an
 * unauthenticated write path into Firestore.
 *
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */
export function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): boolean {
  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest();

  // svix-signature can carry multiple space-separated "v1,<base64>" values
  // (key rotation) — a match on any of them is valid.
  return svixSignature.split(' ').some((entry) => {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) return false;
    let provided: Buffer;
    try {
      provided = Buffer.from(sig, 'base64');
    } catch {
      return false;
    }
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}
