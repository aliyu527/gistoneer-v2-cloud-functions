import {randomInt, createHmac} from 'crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

export function generateOtp(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/**
 * HMAC the code with a server-only pepper (a Functions secret) so the
 * `emailVerifications` doc never holds a reversible or crackable-in-place
 * value even though rules already deny all client access to it.
 */
export function hashOtp(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

export function otpMatches(code: string, hash: string, pepper: string): boolean {
  return hashOtp(code, pepper) === hash;
}
