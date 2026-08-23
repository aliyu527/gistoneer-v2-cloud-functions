import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {normalizeUsername} from '../lib/normalize';
import type {CompleteUserProfileRequest} from '../lib/types';

const MIN_AGE_YEARS = 13;

function isValidBirthday(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  if (date.getTime() > Date.now()) return false; // no future birthdays

  const minValidDate = new Date();
  minValidDate.setFullYear(minValidDate.getFullYear() - MIN_AGE_YEARS);
  return date.getTime() <= minValidDate.getTime();
}

/**
 * Finalizes registration: username must already be reserved to this uid
 * (via reserveUsername), birthday/interests get validated and written, and
 * onboardingCompleted flips to true — the single signal the client's
 * AuthProvider uses to route into the main app instead of onboarding.
 */
export const completeUserProfile = onCall<CompleteUserProfileRequest, Promise<{onboardingCompleted: true}>>(
  {cors: true},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const uid = request.auth.uid;
    const {username, birthday, interests} = request.data ?? {};
    const usernameLower = normalizeUsername(username ?? '');

    if (!usernameLower) {
      throw new HttpsError('invalid-argument', 'Please choose a valid username first.');
    }
    if (!birthday || !isValidBirthday(birthday)) {
      throw new HttpsError('invalid-argument', 'Please enter a valid birthday.');
    }
    if (!Array.isArray(interests) || interests.length === 0) {
      throw new HttpsError('invalid-argument', 'Please choose at least one interest.');
    }

    const reservation = await db.collection('usernames').doc(usernameLower).get();
    if (!reservation.exists || reservation.data()?.uid !== uid) {
      throw new HttpsError(
        'failed-precondition',
        'Please choose your username again before finishing.',
      );
    }

    // email/phone/primaryMethod/authProviders were already written by
    // setAccountPassword — this step only adds the remaining onboarding
    // fields, it doesn't re-derive identity fields from the Auth record
    // (userRecord.email may hold the internal phone-alias, not a real email).
    await db.collection('users').doc(uid).set(
      {
        uid,
        username,
        usernameLower,
        birthday,
        interests,
        onboardingCompleted: true,
        updatedAt: new Date(),
      },
      {merge: true},
    );

    return {onboardingCompleted: true};
  },
);
