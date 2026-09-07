import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {isReservedUsername} from '../lib/reservedUsernames';

/**
 * The single username-uniqueness mechanism in this codebase — extracted
 * from reserveUsername.ts (Module 04's registration flow) so the admin
 * Create User function (functions/src/functions/admin/adminCreateUser.ts)
 * reuses the exact same transaction rather than a parallel check. Callers
 * must pass an already-normalized `usernameLower` (via normalizeUsername).
 */
export async function reserveUsernameForUid(uid: string, usernameLower: string): Promise<void> {
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

    const previousUsernameLower = userDoc.data()?.usernameLower as string | undefined;
    if (previousUsernameLower && previousUsernameLower !== usernameLower) {
      tx.delete(db.collection('usernames').doc(previousUsernameLower));
    }

    tx.set(usernameRef, {uid, createdAt: new Date()});
    tx.set(userRef, {usernameLower, updatedAt: new Date()}, {merge: true});
  });
}

/** Compensating rollback for a partially-failed admin-driven account creation — releases a username reservation that was just made, so a failed attempt never permanently squats a handle. Never throws (best-effort cleanup). */
export async function releaseUsernameReservation(usernameLower: string): Promise<void> {
  await db
    .collection('usernames')
    .doc(usernameLower)
    .delete()
    .catch(() => {});
}
