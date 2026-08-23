import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {normalizeEmail} from '../lib/normalize';
import {generateOtp, hashOtp, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS} from '../lib/otp';
import {sendVerificationEmail} from '../lib/resend';
import {RESEND_API_KEY, OTP_HASH_PEPPER, EMAIL_FROM} from '../config';
import type {SendEmailCodeRequest} from '../lib/types';

/**
 * Always responds the same way regardless of whether the email is eligible
 * for this purpose — callers (registration vs. recovery UI) must not be able
 * to distinguish "sent" from "no such account" from the response shape.
 */
export const sendEmailVerificationCode = onCall<SendEmailCodeRequest, Promise<{sent: true}>>(
  {cors: true, secrets: [RESEND_API_KEY, OTP_HASH_PEPPER, EMAIL_FROM]},
  async (request) => {
    const {email: rawEmail, purpose} = request.data ?? {};
    const email = normalizeEmail(rawEmail ?? '');
    if (!email || (purpose !== 'registration' && purpose !== 'reset')) {
      throw new HttpsError('invalid-argument', 'Please enter a valid email address.');
    }

    const suppressed = await db.collection('suppressedEmails').doc(email).get();
    if (suppressed.exists) {
      // Deliverability, not account existence — safe to be direct about it.
      throw new HttpsError(
        'invalid-argument',
        "We can't deliver messages to that email address. Please try a different one.",
      );
    }

    const docRef = db.collection('emailVerifications').doc(email);
    const existing = await docRef.get();
    const now = Date.now();

    if (existing.exists) {
      const lastSentAt = existing.data()?.lastSentAt?.toMillis?.() ?? 0;
      if (now - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
        throw new HttpsError(
          'resource-exhausted',
          'Please wait a moment before requesting another code.',
        );
      }
    }

    const code = generateOtp();
    const codeHash = hashOtp(code, OTP_HASH_PEPPER.value());

    await docRef.set({
      codeHash,
      purpose,
      attempts: 0,
      expiresAt: new Date(now + OTP_TTL_MS),
      lastSentAt: new Date(now),
      createdAt: existing.exists ? existing.data()?.createdAt : new Date(now),
    });

    try {
      await sendVerificationEmail(RESEND_API_KEY.value(), EMAIL_FROM.value(), email, code, purpose);
    } catch (err) {
      console.error('Resend send failed', {purpose}); // never log the code or the raw error body
      throw new HttpsError('unavailable', "We couldn't send the code right now. Please try again.");
    }

    return {sent: true};
  },
);
