import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';

const BATCH_SIZE = 400;
/** The one deploy account — there's no admin/role system anywhere in this codebase to reuse (checked), so a hardcoded single-operator allowlist is the simplest safe gate for a temporary, one-off migration. */
const ALLOWED_EMAIL = 'gistoneer@gmail.com';

interface BackfillSoundVisibilityResponse {
  updated: number;
}

/**
 * TEMPORARY, one-off migration — remove this file and its export from
 * index.ts once run. Every existing sounds/{id} doc was created with
 * visibility hardcoded to 'private' (see createSound.ts's prior default);
 * the "public sounds" feature changes the default to 'public' going
 * forward, but that alone doesn't touch already-existing docs (a
 * visibility=='public' rule/query check won't match a doc whose field is
 * explicitly still 'private'). This flips every non-public sound to
 * 'public' in one pass. Only ever invoked manually, once, after explicit
 * confirmation — never called from client UI, never part of a normal deploy.
 */
export const backfillSoundVisibility = onCall<undefined, Promise<BackfillSoundVisibilityResponse>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth || request.auth.token.email !== ALLOWED_EMAIL) {
      throw new HttpsError('permission-denied', 'Not authorized.');
    }

    let updated = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

    for (;;) {
      let q = db.collection('sounds').orderBy('__name__').limit(BATCH_SIZE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;

      const batch = db.batch();
      let batchHasWrites = false;
      snap.docs.forEach((doc) => {
        if (doc.data().visibility !== 'public') {
          batch.update(doc.ref, {visibility: 'public'});
          batchHasWrites = true;
          updated += 1;
        }
      });
      if (batchHasWrites) await batch.commit();

      cursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < BATCH_SIZE) break;
    }

    return {updated};
  },
);
