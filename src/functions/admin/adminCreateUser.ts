import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {auth, db} from '../../admin';
import {normalizeEmail, normalizeUsername} from '../../lib/normalize';
import {isValidBirthday, MIN_AGE_YEARS} from '../completeUserProfile';
import {reserveUsernameForUid, releaseUsernameReservation} from '../../users/service';
import {enforceRateLimit} from '../../lib/rateLimit';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';

const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 60;

interface AdminCreateUserRequest {
  email?: string;
  password?: string;
  username?: string;
  displayName?: string;
  birthday?: string;
  interests?: string[];
}

interface AdminCreateUserResponse {
  uid: string;
  username: string;
  displayName: string | null;
  email: string;
  status: 'active';
  createdAt: string;
}

/**
 * First admin-triggered real-account-creation path in this codebase — every
 * other account is self-registered through the 5-step mobile wizard
 * (identifier → password → username/birthday → interests). This performs
 * the equivalent of that whole wizard as one atomic server-side operation
 * (Decision 3), with compensating rollback on partial failure so a failed
 * attempt never leaves an orphaned Auth account or a permanently-squatted
 * username. Email + password only (Decision 1) — the one proven
 * auth.createUser() shape in this codebase, from verifyEmailVerificationCode.ts's
 * self-service email-OTP path.
 */
export const adminCreateUser = onCall<AdminCreateUserRequest, Promise<AdminCreateUserResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'users.create');
  await enforceRateLimit(admin.uid, 'adminCreateUser', {maxPerWindow: 20, windowMs: 10 * 60 * 1000});

  const data = request.data ?? {};

  const email = normalizeEmail(data.email ?? '');
  if (!email) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  const password = data.password ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpsError('invalid-argument', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const usernameLower = normalizeUsername(data.username ?? '');
  if (!usernameLower) {
    throw new HttpsError('invalid-argument', 'Usernames must be 3-20 characters and can only contain lowercase letters, numbers, and underscores.');
  }
  if (!data.birthday || !isValidBirthday(data.birthday)) {
    throw new HttpsError('invalid-argument', `Enter a valid birthday — the user must be at least ${MIN_AGE_YEARS} years old.`);
  }
  if (!Array.isArray(data.interests) || data.interests.length === 0) {
    throw new HttpsError('invalid-argument', 'Choose at least one interest.');
  }
  const displayName = (data.displayName ?? '').trim();
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new HttpsError('invalid-argument', `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`);
  }

  const existingByEmail = await auth.getUserByEmail(email).catch(() => null);
  if (existingByEmail) {
    throw new HttpsError('already-exists', 'An account already exists with this email address.');
  }

  let createdUid: string | null = null;
  try {
    // Step 1: create the real Firebase Auth account (the actual identity) —
    // done first since the username reservation needs a real uid to key off.
    const userRecord = await auth.createUser({email, password, emailVerified: true, displayName: displayName || undefined});
    createdUid = userRecord.uid;

    // Step 2: reserve the username against the now-known uid — rolled back below on any later failure.
    await reserveUsernameForUid(createdUid, usernameLower);

    // Step 3: write the complete Firestore profile in one shot (unlike the
    // 3-function client wizard, this is a single trusted server-side write).
    const now = new Date();
    await db.collection('users').doc(createdUid).set({
      uid: createdUid,
      email,
      phone: null,
      phoneVerified: false,
      emailVerified: true,
      primaryMethod: 'email',
      authProviders: ['password'],
      username: data.username,
      usernameLower,
      displayName: displayName || null,
      birthday: data.birthday,
      interests: data.interests,
      isVerified: false,
      onboardingCompleted: true,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'user.create',
      targetType: 'user',
      targetId: createdUid,
      reason: null,
      metadata: {email, username: data.username},
    }).catch(() => {});

    return {
      uid: createdUid,
      username: data.username as string,
      displayName: displayName || null,
      email,
      status: 'active',
      createdAt: now.toISOString(),
    };
  } catch (error) {
    // Compensating rollback: undo whatever partially succeeded so a failed
    // attempt never leaves an orphaned Auth account or a squatted username.
    if (createdUid) {
      await releaseUsernameReservation(usernameLower);
      await auth.deleteUser(createdUid).catch(() => {});
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Unable to create this user. Please try again.');
  }
});
