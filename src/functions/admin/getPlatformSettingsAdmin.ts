import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {getPlatformSettings, type PlatformSettings} from '../../lib/platformSettings';
import {requireActiveAdmin} from './requireActiveAdmin';

interface PlatformSettingsAdminResponse extends PlatformSettings {
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Reads through the same cached getPlatformSettings() the real consumers use — what an admin sees here is exactly what's actually being enforced, not a separate view of the data. */
export const getPlatformSettingsAdmin = onCall<undefined, Promise<PlatformSettingsAdminResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'settings.read');

  const [settings, snap] = await Promise.all([getPlatformSettings(), db.collection('settings').doc('platform').get()]);
  const data = snap.data();

  return {
    ...settings,
    updatedAt: data?.updatedAt?.toDate?.().toISOString() ?? null,
    updatedBy: (data?.updatedBy as string) ?? null,
  };
});
