import {defineSecret, defineString} from 'firebase-functions/params';

// Set these with:
//   firebase functions:secrets:set RESEND_API_KEY
//   firebase functions:secrets:set OTP_HASH_PEPPER
//   firebase functions:secrets:set EMAIL_FROM
//   firebase functions:secrets:set RESEND_WEBHOOK_SECRET
// Never put any of these in the mobile app or in source control.
export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
export const OTP_HASH_PEPPER = defineSecret('OTP_HASH_PEPPER');
export const EMAIL_FROM = defineSecret('EMAIL_FROM'); // e.g. "Gistoneer <noreply@yourdomain.com>" — must match a verified Resend sending domain
// From the Resend dashboard: Webhooks -> your endpoint -> Signing Secret (starts with "whsec_").
export const RESEND_WEBHOOK_SECRET = defineSecret('RESEND_WEBHOOK_SECRET');

// The Firebase Web API key is NOT a secret — it's the same public value
// already embedded in every client's google-services.json/GoogleService-Info.plist.
// Set it via a functions/.env file (defineString params are read from .env,
// not a CLI flag): functions/.env -> WEB_API_KEY=AIza...
// Named WEB_API_KEY rather than FIREBASE_WEB_API_KEY — Cloud Functions
// reserves the FIREBASE_/X_GOOGLE_/EXT_ env var prefixes and refuses to
// deploy if a .env key starts with one.
export const WEB_API_KEY = defineString('WEB_API_KEY');
