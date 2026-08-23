import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../admin';
import {normalizeUsername} from '../lib/normalize';
import {phoneAliasEmail} from '../lib/phoneAlias';
import {verifyPasswordViaIdentityToolkit} from '../lib/identityToolkit';
import {WEB_API_KEY} from '../config';

interface SignInWithUsernameRequest {
  username: string;
  password: string;
}

/**
 * Password login for the username identifier. Exists because
 * resolveIdentifier deliberately never reveals the real phone/email behind
 * a username (that's the anti-enumeration boundary), so the client has
 * nothing to call signInWithEmailAndPassword/signInWithPhonePassword with
 * itself — the server has to do the credential check and hand back a
 * session instead.
 */
export const signInWithUsername = onCall<SignInWithUsernameRequest, Promise<{customToken: string}>>(
  {cors: true},
  async (request) => {
    const usernameLower = normalizeUsername(request.data?.username ?? '');
    const password = request.data?.password ?? '';

    if (!usernameLower || !password) {
      throw new HttpsError('invalid-argument', 'Please enter your username and password.');
    }

    const usernameDoc = await db.collection('usernames').doc(usernameLower).get();
    if (!usernameDoc.exists) {
      throw new HttpsError('invalid-argument', 'Incorrect password. Please try again.');
    }

    const uid = usernameDoc.data()?.uid as string;
    const userRecord = await auth.getUser(uid);

    const hasRealEmail = !!userRecord.email && !userRecord.email.endsWith('@phone.gistoneer.internal');
    const signInEmail = hasRealEmail
      ? userRecord.email!
      : phoneAliasEmail(userRecord.phoneNumber ?? '');

    const ok = await verifyPasswordViaIdentityToolkit(WEB_API_KEY.value(), signInEmail, password);
    if (!ok) {
      throw new HttpsError('invalid-argument', 'Incorrect password. Please try again.');
    }

    const customToken = await auth.createCustomToken(uid);
    return {customToken};
  },
);
