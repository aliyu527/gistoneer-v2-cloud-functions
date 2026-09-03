import {createHmac, timingSafeEqual} from 'crypto';

/**
 * Shared by every Agora webhook this app receives (Media Gateway, Cloud
 * Recording, ...) — the envelope and signature scheme are identical across
 * Agora's products: HMAC-SHA256 over the raw request body, hex-encoded, in
 * the Agora-Signature-V2 header (the secret is generated per-webhook in
 * Agora Console when you register the URL). Verifying this is what stops
 * anyone on the internet from POSTing fake events at these endpoints —
 * without it, they're an unauthenticated way to flip live/recording state.
 */
export function verifyAgoraWebhookSignature(secret: string, signatureHeader: string, rawBody: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signatureHeader, 'utf8');
  return expectedBuf.length === providedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}
