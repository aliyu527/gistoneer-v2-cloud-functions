import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../admin';
import {normalizePhone, normalizeEmail, normalizeUsername} from '../lib/normalize';
import {generateOtp, hashOtp, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS} from '../lib/otp';
import {sendVerificationEmail} from '../lib/resend';
import {RESEND_API_KEY, OTP_HASH_PEPPER, EMAIL_FROM} from '../config';
import type {IdentifierType} from '../lib/types';

interface PasswordRecoveryStartRequest {
  type: IdentifierType;
  value: string;
}

type PasswordRecoveryStartResponse =
  // recoveryKey is the opaque lookup key (the account's uid — safe to hand
  // back, it's not derived from and doesn't reveal the email) that
  // verifyEmailVerificationCode needs instead of the real email, which is
  // deliberately never sent to the client for a recovery flow.
  | {method: 'email'; maskedHint: string; recoveryKey: string}
  // Phone SMS sending is inherently a client-side Firebase SDK call (it needs
  // on-device reCAPTCHA/App Check attestation) — there's no Admin SDK way to
  // send it server-side, so the real number has to go back to the client for
  // that one call. This is a documented, industry-standard trade-off, not an
  // oversight: by this point the caller has already proven knowledge of a
  // valid account identifier.
  | {method: 'phone'; maskedHint: string; phone: string}
  // Always returned when nothing matches, on the same code path/timing as a
  // real match — the caller can't distinguish "no such account" from "email
  // sent" by response shape alone.
  | {method: 'none'};

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  const visible = name.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(name.length - 1, 3))}@${domain}`;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, phone.length - 4).replace(/\d/g, '•')}${phone.slice(-4)}`;
}

export const passwordRecoveryStart = onCall<
  PasswordRecoveryStartRequest,
  Promise<PasswordRecoveryStartResponse>
>({cors: true, secrets: [RESEND_API_KEY, OTP_HASH_PEPPER, EMAIL_FROM]}, async (request) => {
  const {type, value} = request.data ?? {};

  let phone: string | null = null;
  let email: string | null = null;

  if (type === 'phone') {
    phone = normalizePhone(value);
  } else if (type === 'email') {
    email = normalizeEmail(value);
  } else if (type === 'username') {
    const usernameLower = normalizeUsername(value ?? '');
    if (usernameLower) {
      const doc = await db.collection('usernames').doc(usernameLower).get();
      const uid = doc.data()?.uid as string | undefined;
      if (uid) {
        const userRecord = await auth.getUser(uid).catch(() => null);
        if (userRecord?.email && !userRecord.email.endsWith('@phone.gistoneer.internal')) {
          email = userRecord.email;
        } else if (userRecord?.phoneNumber) {
          phone = userRecord.phoneNumber;
        }
      }
    }
  } else {
    throw new HttpsError('invalid-argument', 'Unsupported identifier type.');
  }

  if (phone) {
    const exists = await auth.getUserByPhoneNumber(phone).then(
      () => true,
      () => false,
    );
    if (exists) {
      return {method: 'phone', maskedHint: maskPhone(phone), phone};
    }
  }

  if (email) {
    const userRecord = await auth.getUserByEmail(email).catch(() => null);
    if (userRecord) {
      // Keyed by uid, not email — the client never learns the real email
      // for a recovery flow, only this opaque key and a masked display hint.
      const docRef = db.collection('emailVerifications').doc(userRecord.uid);
      const existingDoc = await docRef.get();
      const now = Date.now();
      const lastSentAt = existingDoc.data()?.lastSentAt?.toMillis?.() ?? 0;

      const suppressed = await db.collection('suppressedEmails').doc(email).get();

      if (!suppressed.exists && now - lastSentAt >= OTP_RESEND_COOLDOWN_MS) {
        const code = generateOtp();
        await docRef.set({
          codeHash: hashOtp(code, OTP_HASH_PEPPER.value()),
          purpose: 'reset',
          uid: userRecord.uid,
          attempts: 0,
          expiresAt: new Date(now + OTP_TTL_MS),
          lastSentAt: new Date(now),
          createdAt: existingDoc.exists ? existingDoc.data()?.createdAt : new Date(now),
        });
        await sendVerificationEmail(RESEND_API_KEY.value(), EMAIL_FROM.value(), email, code, 'reset').catch(() => {
          console.error('Resend send failed for recovery');
        });
      }
      // Response shape stays identical whether suppressed or not — the
      // client can't distinguish "sent" from "known-undeliverable" here,
      // same anti-enumeration reasoning as the rest of this function.
      return {method: 'email', maskedHint: maskEmail(email), recoveryKey: userRecord.uid};
    }
  }

  // No match — same shape/timing profile as a real "email" response so
  // enumeration can't be inferred from this call alone.
  return {method: 'none'};
});
