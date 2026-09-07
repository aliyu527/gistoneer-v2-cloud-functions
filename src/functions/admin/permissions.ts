import type {AdminRole} from './bootstrapAdmin';

/**
 * Server-side mirror of admin/src/constants/permissions.ts — kept in sync by
 * hand (no shared package between the two apps, same convention as AdminRole
 * itself being independently defined in both). This is the ACTUAL
 * enforcement; the client copy is UI-only (hides buttons a role can't use).
 */
export type Permission =
  | 'users.read'
  | 'users.write'
  | 'users.suspend'
  | 'content.read'
  | 'content.moderate'
  | 'content.delete'
  | 'sounds.read'
  | 'sounds.moderate'
  | 'live.read'
  | 'live.moderate'
  | 'live.end'
  | 'reports.read'
  | 'reports.resolve'
  | 'analytics.read'
  | 'notifications.read'
  | 'notifications.send'
  | 'marketplace.read'
  | 'marketplace.moderate'
  | 'marketplace.vendors.manage'
  | 'settings.read'
  | 'settings.write'
  | 'admins.read'
  | 'admins.manage'
  | 'audit.read';

const ALL_PERMISSIONS: Permission[] = [
  'users.read',
  'users.write',
  'users.suspend',
  'content.read',
  'content.moderate',
  'content.delete',
  'sounds.read',
  'sounds.moderate',
  'live.read',
  'live.moderate',
  'live.end',
  'reports.read',
  'reports.resolve',
  'analytics.read',
  'notifications.read',
  'notifications.send',
  'marketplace.read',
  'marketplace.moderate',
  'marketplace.vendors.manage',
  'settings.read',
  'settings.write',
  'admins.read',
  'admins.manage',
  'audit.read',
];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== 'admins.manage'),
  moderator: ['content.read', 'content.moderate', 'content.delete', 'sounds.read', 'sounds.moderate', 'live.read', 'live.moderate', 'live.end', 'reports.read', 'reports.resolve'],
  support: ['users.read', 'reports.read'],
};

export function roleHasPermission(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
