import {initializeApp, getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';

// Single shared Admin SDK initialization — every function file imports
// `auth`/`db` from here instead of calling initializeApp() itself.
if (getApps().length === 0) {
  initializeApp();
}

export const auth = getAuth();
export const db = getFirestore();
