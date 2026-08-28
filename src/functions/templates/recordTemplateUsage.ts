import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {recordUsage} from '../../templates/service';

interface RecordTemplateUsageRequest {
  templateId: string;
}

/** Called once when a user actually applies a template (not on preview/browse) — real usage tracking, not a fabricated metric. */
export const recordTemplateUsage = onCall<RecordTemplateUsageRequest, Promise<{recorded: true}>>(
  {cors: true, region: 'us-central1'},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Please sign in and try again.');
    }
    const {templateId} = request.data ?? {};
    if (typeof templateId !== 'string' || templateId.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing template reference.');
    }

    await recordUsage(templateId);
    return {recorded: true};
  },
);
