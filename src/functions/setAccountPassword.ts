import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../admin';
import {phoneAliasEmail} from '../lib/phoneAlias';

interface SetAccountPasswordRequest {
  password: string;
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * Sets/overwrites the password for the CURRENTLY authenticated user —
 * used both right after registration verification and for password reset.
 * Both call sites only reach here after proving ownership of the identifier
 * (a confirmed phone SMS code, or a confirmed email code exchanged for a
 * custom token), so re-setting the password here is safe.
 *
 * Firebase Auth's password provider is inherently email-based. Phone-only
 * accounts get a deterministic, non-deliverable alias email attached here
 * (see lib/phoneAlias.ts) purely so `signInWithEmailAndPassword` has
 * something to key off later — this alias is never shown to the user and
 * never written to Firestore.
 */
export const setAccountPassword = onCall<SetAccountPasswordRequest, Promise<{primaryMethod: 'phone' | 'email'}>>(
  {cors: true},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const password = request.data?.password ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpsError('invalid-argument', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const uid = request.auth.uid;
    const userRecord = await auth.getUser(uid);

    const hasRealEmail = !!userRecord.email && !userRecord.email.endsWith('@phone.gistoneer.internal');
    const primaryMethod: 'phone' | 'email' = hasRealEmail ? 'email' : 'phone';

    const update: {password: string; email?: string; emailVerified?: boolean} = {password};
    if (!hasRealEmail) {
      if (!userRecord.phoneNumber) {
        throw new HttpsError('failed-precondition', "We couldn't complete the request. Please try again.");
      }
      update.email = phoneAliasEmail(userRecord.phoneNumber);
      update.emailVerified = true;
    }

    await auth.updateUser(uid, update);

    const userDocRef = db.collection('users').doc(uid);
    const existingDoc = await userDocRef.get();
    const authProvider = primaryMethod === 'phone' ? 'phone' : 'password';

    await userDocRef.set(
      {
        uid,
        email: hasRealEmail ? userRecord.email : null,
        phone: userRecord.phoneNumber ?? null,
        phoneVerified: !!userRecord.phoneNumber,
        emailVerified: hasRealEmail ? true : false,
        primaryMethod,
        authProviders: FieldValue.arrayUnion(authProvider),
        updatedAt: new Date(),
        ...(existingDoc.exists ? {} : {createdAt: new Date(), onboardingCompleted: false}),
      },
      {merge: true},
    );

    return {primaryMethod};
  },
);
