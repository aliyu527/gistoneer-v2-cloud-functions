import type {AdminSoundCreator} from './adminSoundShared';

/**
 * Extracted from adminListPlaylists.ts when that function was migrated to a
 * direct Firestore read (admin panel Cloud Run cost-reduction migration) —
 * adminSearchPlaylists.ts and adminGetPlaylistDetail.ts still need this
 * shape, so it lives here now instead of being deleted along with the list
 * callable itself.
 */
export interface AdminPlaylistListItem {
  id: string;
  ownerId: string;
  creator: AdminSoundCreator;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  trackCount: number;
  visibility: 'public' | 'private';
  createdAt: string | null;
  updatedAt: string | null;
}
