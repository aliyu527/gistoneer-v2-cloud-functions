import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../admin';
import {normalizePhone, normalizeEmail, normalizeUsername} from '../lib/normalize';
import type {ResolveIdentifierRequest, ResolveIdentifierResponse} from '../lib/types';

/**
 * Determines whether an identifier (phone/email/username) belongs to an
 * existing, verified account — without ever exposing which specific record
 * matched or any profile data. This is the anti-enumeration boundary: the
 * client never runs a direct Firestore query against `users` by phone/email.
 */
export const resolveIdentifier = onCall<ResolveIdentifierRequest, Promise<ResolveIdentifierResponse>>(
  {cors: true},
  async (request) => {
    const {type, value} = request.data ?? {};

    if (type === 'phone') {
      const phone = normalizePhone(value);
      if (!phone) {
        throw new HttpsError('invalid-argument', 'Please enter a valid phone number.');
      }
      try {
        await auth.getUserByPhoneNumber(phone);
        // A Firebase phone-auth user is only ever created after a
        // successful SMS confirmation, so existence implies verified.
        return {exists: true, verified: true, method: 'phone'};
      } catch {
        return {exists: false, verified: false, method: 'phone'};
      }
    }

    if (type === 'email') {
      const email = normalizeEmail(value);
      if (!email) {
        throw new HttpsError('invalid-argument', 'Please enter a valid email address.');
      }
      try {
        const user = await auth.getUserByEmail(email);
        return {exists: true, verified: !!user.emailVerified, method: 'email'};
      } catch {
        return {exists: false, verified: false, method: 'email'};
      }
    }

    if (type === 'username') {
      const usernameLower = normalizeUsername(value);
      if (!usernameLower) {
        throw new HttpsError('invalid-argument', 'Please enter a valid username.');
      }
      const doc = await db.collection('usernames').doc(usernameLower).get();
      if (!doc.exists) {
        return {exists: false, verified: false, method: 'phone'};
      }
      const uid = doc.data()?.uid as string | undefined;
      const profile = uid ? await db.collection('users').doc(uid).get() : null;
      const primaryMethod = (profile?.data()?.primaryMethod as 'phone' | 'email' | undefined) ?? 'phone';
      return {exists: true, verified: true, method: primaryMethod};
    }

    throw new HttpsError('invalid-argument', 'Unsupported identifier type.');
  },
);
