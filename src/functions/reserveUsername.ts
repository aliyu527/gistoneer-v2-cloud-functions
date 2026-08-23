import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {normalizeUsername} from '../lib/normalize';
import {isReservedUsername} from '../lib/reservedUsernames';
import type {ReserveUsernameRequest} from '../lib/types';

/**
 * Atomically reserves a username for the calling user. Runs as a Firestore
 * transaction so "check then write" can never race two signups onto the
 * same handle.
 */
export const reserveUsername = onCall<ReserveUsernameRequest, Promise<{usernameLower: string}>>(
  {cors: true},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const usernameLower = normalizeUsername(request.data?.username ?? '');

    if (!usernameLower) {
      throw new HttpsError(
        'invalid-argument',
        'Usernames must be 3-20 characters and can only contain lowercase letters, numbers, and underscores.',
      );
    }
    if (isReservedUsername(usernameLower)) {
      throw new HttpsError('already-exists', 'That username isn’t available.');
    }

    const usernameRef = db.collection('usernames').doc(usernameLower);
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (tx) => {
      const [usernameDoc, userDoc] = await Promise.all([tx.get(usernameRef), tx.get(userRef)]);

      if (usernameDoc.exists) {
        throw new HttpsError('already-exists', 'That username is taken. Please try another.');
      }

      // Release any username this user previously held.
      const previousUsernameLower = userDoc.data()?.usernameLower as string | undefined;
      if (previousUsernameLower && previousUsernameLower !== usernameLower) {
        tx.delete(db.collection('usernames').doc(previousUsernameLower));
      }

      tx.set(usernameRef, {uid, createdAt: new Date()});
      tx.set(
        userRef,
        {usernameLower, updatedAt: new Date()},
        {merge: true},
      );
    });

    return {usernameLower};
  },
);
