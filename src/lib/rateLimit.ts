import {HttpsError} from 'firebase-functions/v2/https';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {db} from '../admin';

interface RateLimitOptions {
  maxPerWindow: number;
  windowMs: number;
}

/**
 * Minimal per-uid fixed-window rate limiter backed by a Firestore
 * transaction (no Redis/Memorystore in this stack). Sufficient to blunt
 * scripted abuse of a single endpoint — not a hard, distributed-exact
 * boundary. Doc lives at rateLimits/{uid}_{bucket}, fully server-only
 * (Firestore rules: allow read, write: if false), so it's never client
 * readable or writable.
 */
export async function enforceRateLimit(uid: string, bucket: string, {maxPerWindow, windowMs}: RateLimitOptions): Promise<void> {
  const ref = db.collection('rateLimits').doc(`${uid}_${bucket}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as {windowStart?: Timestamp; count?: number}) : undefined;
    const windowStartMs = data?.windowStart?.toMillis() ?? 0;
    const withinWindow = Date.now() - windowStartMs < windowMs;
    const currentCount = withinWindow ? (data?.count ?? 0) : 0;

    if (currentCount >= maxPerWindow) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please try again in a few minutes.');
    }

    tx.set(ref, {
      windowStart: withinWindow ? data!.windowStart : FieldValue.serverTimestamp(),
      count: currentCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
