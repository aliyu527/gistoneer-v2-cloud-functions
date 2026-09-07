import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {getPlatformSettings, invalidatePlatformSettingsCache} from '../../lib/platformSettings';
import {requireActiveAdmin} from './requireActiveAdmin';
import {writeAuditLog} from './writeAuditLog';
import {notifyAdmins} from '../../adminNotifications/service';

const MAX_MESSAGE_LENGTH = 200;
const MIN_SIZE_MB = 1;
const MAX_SIZE_MB = 500;

interface UpdatePlatformSettingsRequest {
  registrationEnabled?: boolean;
  postCreationEnabled?: boolean;
  commentsEnabled?: boolean;
  liveBroadcastingEnabled?: boolean;
  marketplaceEnabled?: boolean;
  maintenanceModeEnabled?: boolean;
  maintenanceMessage?: string;
  maxImageSizeMB?: number;
  maxVideoSizeMB?: number;
  maxAudioSizeMB?: number;
}

interface UpdatePlatformSettingsResponse {
  updated: true;
}

const BOOLEAN_FIELDS: {key: keyof UpdatePlatformSettingsRequest; label: string; storagePath: string}[] = [
  {key: 'registrationEnabled', label: 'Registration Enabled', storagePath: 'registrationEnabled'},
  {key: 'postCreationEnabled', label: 'Post Creation Enabled', storagePath: 'postCreationEnabled'},
  {key: 'commentsEnabled', label: 'Comments Enabled', storagePath: 'commentsEnabled'},
  {key: 'liveBroadcastingEnabled', label: 'Live Broadcasting Enabled', storagePath: 'liveBroadcastingEnabled'},
  {key: 'marketplaceEnabled', label: 'Marketplace Enabled', storagePath: 'marketplaceEnabled'},
  {key: 'maintenanceModeEnabled', label: 'Maintenance Mode', storagePath: 'maintenanceMode.enabled'},
];

function isValidSizeMB(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_SIZE_MB && value <= MAX_SIZE_MB;
}

/**
 * Validates every field, diffs against the current (cache-fresh) settings,
 * writes one audit entry per genuinely-changed field (§44's before/after
 * example, and §81's "no-op saves shouldn't create noise"), merges the
 * write, then invalidates the in-process cache so this same warm instance
 * sees its own change on the very next call.
 */
export const updatePlatformSettings = onCall<UpdatePlatformSettingsRequest, Promise<UpdatePlatformSettingsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  const admin = await requireActiveAdmin(request, 'settings.write');
  const data = request.data ?? {};

  if (data.maintenanceMessage !== undefined && (typeof data.maintenanceMessage !== 'string' || data.maintenanceMessage.length > MAX_MESSAGE_LENGTH)) {
    throw new HttpsError('invalid-argument', `Maintenance message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }
  for (const field of ['maxImageSizeMB', 'maxVideoSizeMB', 'maxAudioSizeMB'] as const) {
    if (data[field] !== undefined && !isValidSizeMB(data[field])) {
      throw new HttpsError('invalid-argument', `${field} must be a whole number between ${MIN_SIZE_MB} and ${MAX_SIZE_MB}.`);
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (data[field.key] !== undefined && typeof data[field.key] !== 'boolean') {
      throw new HttpsError('invalid-argument', `${field.label} must be true or false.`);
    }
  }

  const current = await getPlatformSettings();
  const update: Record<string, unknown> = {};
  const changes: string[] = [];

  let maintenanceJustEnabled = false;
  const justDisabledFeatures: string[] = [];

  for (const field of BOOLEAN_FIELDS) {
    const nextValue = data[field.key] as boolean | undefined;
    if (nextValue === undefined) continue;
    const currentValue = field.key === 'maintenanceModeEnabled' ? current.maintenanceMode.enabled : (current[field.key as keyof typeof current] as boolean);
    if (nextValue !== currentValue) {
      update[field.storagePath] = nextValue;
      changes.push(`${field.label}: ${currentValue} → ${nextValue}`);
      if (field.key === 'maintenanceModeEnabled' && nextValue === true) {
        maintenanceJustEnabled = true;
      } else if (field.key !== 'maintenanceModeEnabled' && nextValue === false) {
        justDisabledFeatures.push(field.label);
      }
    }
  }

  if (data.maintenanceMessage !== undefined && data.maintenanceMessage !== current.maintenanceMode.message) {
    update['maintenanceMode.message'] = data.maintenanceMessage;
    changes.push(`Maintenance Message updated`);
  }

  const sizeFieldLabels: Record<'maxImageSizeMB' | 'maxVideoSizeMB' | 'maxAudioSizeMB', string> = {
    maxImageSizeMB: 'Max Image Size (MB)',
    maxVideoSizeMB: 'Max Video Size (MB)',
    maxAudioSizeMB: 'Max Audio Size (MB)',
  };
  for (const field of ['maxImageSizeMB', 'maxVideoSizeMB', 'maxAudioSizeMB'] as const) {
    const nextValue = data[field];
    if (nextValue === undefined) continue;
    const currentValue = current.mediaLimits[field];
    if (nextValue !== currentValue) {
      update[`mediaLimits.${field}`] = nextValue;
      changes.push(`${sizeFieldLabels[field]}: ${currentValue} → ${nextValue}`);
    }
  }

  if (changes.length === 0) {
    return {updated: true};
  }

  update.updatedAt = FieldValue.serverTimestamp();
  update.updatedBy = admin.email;

  await db.collection('settings').doc('platform').set(update, {merge: true});
  invalidatePlatformSettingsCache();

  for (const change of changes) {
    await writeAuditLog({
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: 'settings.update',
      targetType: 'settings',
      targetId: 'platform',
      reason: change,
    }).catch(() => {});
  }

  if (maintenanceJustEnabled) {
    await notifyAdmins({
      type: 'settings.maintenance_enabled',
      category: 'settings',
      priority: 'critical',
      title: 'Maintenance mode enabled',
      message: 'Maintenance mode was turned on — new registrations, posts, comments, live sessions, and marketplace activity are now blocked.',
      targetPermission: 'settings.write',
      resourceType: 'settings',
      resourceId: 'platform',
      actionUrl: '/settings',
      excludeUids: [admin.uid],
      createdBy: admin.uid,
    }).catch(() => {});
  } else if (justDisabledFeatures.length > 0) {
    await notifyAdmins({
      type: 'settings.feature_disabled',
      category: 'settings',
      priority: 'high',
      title: 'Platform feature disabled',
      message: `${justDisabledFeatures.join(', ')} ${justDisabledFeatures.length === 1 ? 'was' : 'were'} turned off.`,
      targetPermission: 'settings.write',
      resourceType: 'settings',
      resourceId: 'platform',
      actionUrl: '/settings',
      excludeUids: [admin.uid],
      createdBy: admin.uid,
    }).catch(() => {});
  }

  return {updated: true};
});
