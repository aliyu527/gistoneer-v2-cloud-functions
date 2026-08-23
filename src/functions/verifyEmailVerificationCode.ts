import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../admin';
import {normalizeEmail} from '../lib/normalize';
import {otpMatches, OTP_MAX_ATTEMPTS} from '../lib/otp';
import {OTP_HASH_PEPPER} from '../config';

interface VerifyEmailCodeRequest {
  /**
   * For purpose "registration": the real email address (the client always
   * knows this — it's what they just typed).
   * For purpose "reset": the opaque recoveryKey from passwordRecoveryStart
   * (the account's uid) — never the real email, which recovery flows don't
   * expose to the client.
   */
  key: string;
  code: string;
  purpose: 'registration' | 'reset';
}

export const verifyEmailVerificationCode = onCall<
  VerifyEmailCodeRequest,
  Promise<{customToken: string}>
>({cors: true, secrets: [OTP_HASH_PEPPER]}, async (request) => {
  const {key: rawKey, code, purpose} = request.data ?? {};
  if (!rawKey || !code || (purpose !== 'registration' && purpose !== 'reset')) {
    throw new HttpsError('invalid-argument', 'Something went wrong. Please try again.');
  }

  const docKey = purpose === 'registration' ? normalizeEmail(rawKey) : rawKey;
  if (!docKey) {
    throw new HttpsError('invalid-argument', 'Something went wrong. Please try again.');
  }

  const docRef = db.collection('emailVerifications').doc(docKey);
  const snap = await docRef.get();

  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'The verification code has expired. Please request a new code.');
  }

  const data = snap.data()!;

  if (data.purpose !== purpose) {
    throw new HttpsError('failed-precondition', 'The verification code has expired. Please request a new code.');
  }

  const expiresAtMs = data.expiresAt?.toMillis?.() ?? 0;
  if (Date.now() > expiresAtMs) {
    await docRef.delete();
    throw new HttpsError('failed-precondition', 'The verification code has expired. Please request a new code.');
  }

  const attempts = (data.attempts as number) ?? 0;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await docRef.delete();
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please request a new code.');
  }

  if (!otpMatches(code, data.codeHash, OTP_HASH_PEPPER.value())) {
    await docRef.update({attempts: attempts + 1});
    throw new HttpsError('invalid-argument', 'That code is incorrect. Please try again.');
  }

  // Single-use: invalidate immediately on success.
  await docRef.delete();

  if (purpose === 'reset') {
    // docKey is the uid directly (set by passwordRecoveryStart) — no lookup needed.
    const customToken = await auth.createCustomToken(docKey);
    return {customToken};
  }

  let uid: string;
  try {
    const existing = await auth.getUserByEmail(docKey);
    uid = existing.uid;
    if (!existing.emailVerified) {
      await auth.updateUser(uid, {emailVerified: true});
    }
  } catch {
    const created = await auth.createUser({email: docKey, emailVerified: true});
    uid = created.uid;
  }

  const customToken = await auth.createCustomToken(uid);
  return {customToken};
});
