/**
 * Extracted from adminListUsers.ts when that function was migrated to a
 * direct Firestore read (admin panel Cloud Run cost-reduction migration) —
 * adminSearchUsers.ts and adminGetUserDetail.ts still need this shared
 * shape, so it lives here now instead of being deleted along with the list
 * callable itself.
 */
export interface AdminUserListItem {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'suspended';
  emailVerified: boolean;
  phoneVerified: boolean;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  createdAt: string | null;
}
