import {createHmac, timingSafeEqual} from 'crypto';

/**
 * Verifying this is what stops anyone on the internet from POSTing fake
 * "encoder connected"/"encoder disconnected" events at the webhook — without
 * it, onMediaGatewayEvent is an unauthenticated way to flip any live session
 * to 'live' or 'ended'. Agora signs with HMAC-SHA256 over the raw request
 * body and sends it hex-encoded in the Agora-Signature-V2 header (the secret
 * is generated per-webhook in Agora Console when you register the URL).
 */
export function verifyAgoraMediaGatewaySignature(secret: string, signatureHeader: string, rawBody: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signatureHeader, 'utf8');
  return expectedBuf.length === providedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}
