/**
 * Extracted from adminListSounds.ts when that function was migrated to a
 * direct Firestore read (admin panel Cloud Run cost-reduction migration) —
 * adminSearchSounds.ts, adminGetSoundDetail.ts, and adminListPlaylists'
 * shared AdminSoundCreator still need this shape, so it lives here now
 * instead of being deleted along with the list callable itself.
 */
export type SoundModerationStatus = 'active' | 'hidden' | 'removed';

export interface AdminSoundCreator {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AdminSoundListItem {
  id: string;
  ownerId: string;
  creator: AdminSoundCreator;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  artworkUrl: string | null;
  audioUrl: string;
  durationMs: number | null;
  visibility: 'public' | 'private';
  moderationStatus: SoundModerationStatus;
  source: 'user_upload' | 'admin_upload';
  categoryIds: string[];
  createdAt: string | null;
}
