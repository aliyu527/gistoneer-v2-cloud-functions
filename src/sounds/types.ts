/**
 * The normalized shape every provider adapter must produce and the ONLY
 * shape ever sent to the client — provider-specific response structures
 * never leak past the adapter (spec §54: normalize at the boundary).
 */
export type LicenseStatus =
  | 'licensed'
  | 'restricted'
  | 'previewOnly'
  | 'unavailable'
  | 'territoryRestricted'
  | 'creatorOnly';

export interface LicenseInfo {
  status: LicenseStatus;
  commercialAllowed?: boolean;
  personalUseOnly?: boolean;
  attributionRequired?: boolean;
  attributionText?: string;
}

export interface SoundTerritory {
  availableCountries?: string[];
  blockedCountries?: string[];
}

export interface GistoneerSound {
  /** Stable Gistoneer-internal id — survives a future provider migration. */
  id: string;
  provider: string;
  providerTrackId: string;
  title: string;
  artist?: string;
  album?: string;
  /** ms */
  durationMs: number;
  artworkUrl?: string;
  /**
   * Streaming preview URL, if the provider permits one. Every mock-catalog
   * entry leaves this unset — there is no real audio behind a dev-only
   * placeholder track, and claiming otherwise would be exactly the kind of
   * fabricated functionality this project avoids everywhere else. A real
   * provider adapter populates this from its own authorized preview asset.
   */
  previewUrl?: string;
  genre?: string;
  genres?: string[];
  explicit?: boolean;
  license: LicenseInfo;
  isAvailable: boolean;
  territory?: SoundTerritory;
  createdAt?: string;
  updatedAt?: string;
}

export interface SoundCategory {
  id: string;
  label: string;
}

/**
 * A saved personal-library sound, hydrated straight from its sounds/{id}
 * doc — deliberately NOT GistoneerSound (which requires provider/license
 * fields a personal upload doesn't have; fabricating them would misrepresent
 * a LIBRARY save as CATALOG downstream).
 */
export interface SavedLibrarySound {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  durationMs?: number;
  audioUrl: string;
  artworkUrl: string | null;
}

/** getSavedSounds' real response shape — a saved id can now be either a catalog track or a personal-library sound (see soundOwnership.ts's CATALOG_SOUND_ID_PREFIX convention). */
export type SavedSound = ({kind: 'CATALOG'} & GistoneerSound) | ({kind: 'LIBRARY'} & SavedLibrarySound);

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

/**
 * What every provider — mock or real — implements. A real HTTP-backed
 * provider (timeouts, retry/backoff, auth token refresh) slots in behind
 * this exact interface with zero change to providerRegistry.ts, the
 * callables, or the client.
 */
export interface SoundProviderAdapter {
  id: string;
  search(query: string, params?: PageParams): Promise<Page<GistoneerSound>>;
  getTrack(providerTrackId: string): Promise<GistoneerSound | null>;
  getTrending(params?: PageParams): Promise<Page<GistoneerSound>>;
  getPopular(params?: PageParams): Promise<Page<GistoneerSound>>;
  getFeatured(params?: PageParams): Promise<Page<GistoneerSound>>;
  getCategories(): Promise<SoundCategory[]>;
  getByCategory(categoryId: string, params?: PageParams): Promise<Page<GistoneerSound>>;
}
