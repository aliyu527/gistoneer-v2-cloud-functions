import {db} from '../admin';

export interface PlatformSettings {
  registrationEnabled: boolean;
  postCreationEnabled: boolean;
  commentsEnabled: boolean;
  liveBroadcastingEnabled: boolean;
  marketplaceEnabled: boolean;
  maintenanceMode: {
    enabled: boolean;
    message: string;
  };
  mediaLimits: {
    maxImageSizeMB: number;
    maxVideoSizeMB: number;
    maxAudioSizeMB: number;
  };
}

/** The exact current hardcoded behavior — every consumer's default until an admin deliberately changes something, so this module's rollout is a no-op by construction. mediaLimits mirrors lib/mediaValidation.ts's MEDIA_LIMITS exactly. */
export const DEFAULT_SETTINGS: PlatformSettings = {
  registrationEnabled: true,
  postCreationEnabled: true,
  commentsEnabled: true,
  liveBroadcastingEnabled: true,
  marketplaceEnabled: true,
  maintenanceMode: {enabled: false, message: ''},
  mediaLimits: {maxImageSizeMB: 20, maxVideoSizeMB: 200, maxAudioSizeMB: 20},
};

let cached: {value: PlatformSettings; fetchedAt: number} | null = null;
const CACHE_TTL_MS = 30_000;

function mergeWithDefaults(data: FirebaseFirestore.DocumentData | undefined): PlatformSettings {
  if (!data) return DEFAULT_SETTINGS;
  return {
    registrationEnabled: typeof data.registrationEnabled === 'boolean' ? data.registrationEnabled : DEFAULT_SETTINGS.registrationEnabled,
    postCreationEnabled: typeof data.postCreationEnabled === 'boolean' ? data.postCreationEnabled : DEFAULT_SETTINGS.postCreationEnabled,
    commentsEnabled: typeof data.commentsEnabled === 'boolean' ? data.commentsEnabled : DEFAULT_SETTINGS.commentsEnabled,
    liveBroadcastingEnabled: typeof data.liveBroadcastingEnabled === 'boolean' ? data.liveBroadcastingEnabled : DEFAULT_SETTINGS.liveBroadcastingEnabled,
    marketplaceEnabled: typeof data.marketplaceEnabled === 'boolean' ? data.marketplaceEnabled : DEFAULT_SETTINGS.marketplaceEnabled,
    maintenanceMode: {
      enabled: typeof data.maintenanceMode?.enabled === 'boolean' ? data.maintenanceMode.enabled : DEFAULT_SETTINGS.maintenanceMode.enabled,
      message: typeof data.maintenanceMode?.message === 'string' ? data.maintenanceMode.message : DEFAULT_SETTINGS.maintenanceMode.message,
    },
    mediaLimits: {
      maxImageSizeMB: typeof data.mediaLimits?.maxImageSizeMB === 'number' ? data.mediaLimits.maxImageSizeMB : DEFAULT_SETTINGS.mediaLimits.maxImageSizeMB,
      maxVideoSizeMB: typeof data.mediaLimits?.maxVideoSizeMB === 'number' ? data.mediaLimits.maxVideoSizeMB : DEFAULT_SETTINGS.mediaLimits.maxVideoSizeMB,
      maxAudioSizeMB: typeof data.mediaLimits?.maxAudioSizeMB === 'number' ? data.mediaLimits.maxAudioSizeMB : DEFAULT_SETTINGS.mediaLimits.maxAudioSizeMB,
    },
  };
}

/**
 * Fail-safe by construction (§98): a missing/partial settings doc merges
 * over DEFAULT_SETTINGS field-by-field, never leaves a consumer with
 * `undefined`. Cached in-process for 30s — settings change rarely, and
 * every one of this module's consumers (createPost, createComment,
 * createLiveSession, submitVendorApplication, createListing,
 * completeUserProfile, createMediaUploadUrl) would otherwise add one
 * Firestore read to a hot path. invalidatePlatformSettingsCache() is
 * called by updatePlatformSettings.ts right after a successful write so
 * that instance sees its own change immediately; other warm instances
 * catch up within the TTL.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const snap = await db.collection('settings').doc('platform').get();
  const value = mergeWithDefaults(snap.data());
  cached = {value, fetchedAt: Date.now()};
  return value;
}

export function invalidatePlatformSettingsCache(): void {
  cached = null;
}
