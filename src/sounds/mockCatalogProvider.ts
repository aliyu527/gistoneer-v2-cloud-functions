import type {GistoneerSound, Page, PageParams, SoundCategory, SoundProviderAdapter} from './types';

/**
 * DEV ONLY — no real external music provider is configured (see Module 5's
 * plan/audit: no provider credentials exist anywhere in this codebase, and
 * DistroKid has no consumer catalog API). This is static server-side data,
 * not a real catalog, and every track deliberately has no previewUrl — see
 * GistoneerSound.previewUrl's own comment. A real provider adapter
 * implements the exact same SoundProviderAdapter interface and replaces
 * this file without touching providerRegistry.ts, the callables, or the
 * client at all.
 */
const GENRES: SoundCategory[] = [
  {id: 'afrobeats', label: 'Afrobeats'},
  {id: 'hiphop', label: 'Hip-Hop'},
  {id: 'pop', label: 'Pop'},
  {id: 'rnb', label: 'R&B'},
  {id: 'amapiano', label: 'Amapiano'},
  {id: 'instrumental', label: 'Instrumental'},
];

const TRACK_TITLES = [
  'Golden Hour', 'Late Night Drive', 'City Lights', 'Slow Mornings', 'Higher',
  'Neon Rain', 'Backroad', 'Still Water', 'Sunday Groove', 'Fast Lane',
  'Open Road', 'Midnight Talk', 'Paper Planes', 'Low Key', 'Sunlit',
  'Echoes', 'Warm Static', 'Blue Hour', 'Fever Dream', 'Homebound',
  'Gravity', 'Wildflower', 'Afterglow', 'Skyline', 'Dust & Gold',
  'Velvet', 'Comet', 'Roots', 'Second Wind', 'Tideline',
  'Halfway Home', 'Lanterns', 'Freehand', 'Static Bloom', 'Amber',
  'North Star',
];

const ARTIST_NAMES = [
  'Lumen', 'Nova Sound', 'Kaia', 'Reed & Vale', 'DJ Tempo', 'Vess', 'Marlow',
  'Anemoi', 'Oja', 'Kade', 'Fenna', 'Isko', 'Bellwave', 'Runo', 'Yara Noor',
];

function buildCatalog(): GistoneerSound[] {
  const tracks: GistoneerSound[] = TRACK_TITLES.map((title, i) => {
    const genre = GENRES[i % GENRES.length];
    const artist = ARTIST_NAMES[i % ARTIST_NAMES.length];
    return {
      id: `mock-${i + 1}`,
      provider: 'mock',
      providerTrackId: `mock-${i + 1}`,
      title,
      artist,
      durationMs: 140000 + ((i * 6173) % 90000),
      genre: genre.label,
      genres: [genre.label],
      explicit: i % 11 === 0,
      license: {status: 'licensed', commercialAllowed: true, attributionRequired: true, attributionText: `${title} — ${artist}`},
      isAvailable: true,
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
    };
  });

  // A handful of deliberately non-default statuses so the "unavailable" /
  // "territory restricted" / "restricted" UI paths are real and testable,
  // not hypothetical (spec §113/§118).
  tracks[3] = {...tracks[3], isAvailable: false, license: {status: 'unavailable'}};
  tracks[9] = {
    ...tracks[9],
    isAvailable: false,
    license: {status: 'territoryRestricted'},
    territory: {availableCountries: ['US', 'CA', 'GB']},
  };
  tracks[17] = {...tracks[17], license: {status: 'restricted', commercialAllowed: false, personalUseOnly: true}};
  tracks[24] = {...tracks[24], license: {status: 'creatorOnly', commercialAllowed: false}};

  return tracks;
}

const CATALOG = buildCatalog();

function paginate(items: GistoneerSound[], params?: PageParams): Page<GistoneerSound> {
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 50);
  const offset = params?.cursor ? Math.max(0, parseInt(params.cursor, 10) || 0) : 0;
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {items: slice, nextCursor: nextOffset < items.length ? String(nextOffset) : undefined};
}

export const mockCatalogProvider: SoundProviderAdapter = {
  id: 'mock',

  async search(query, params) {
    const q = query.trim().toLowerCase();
    if (!q) return {items: []};
    const matches = CATALOG.filter(
      (t) => t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q) || (t.genre ?? '').toLowerCase().includes(q),
    );
    return paginate(matches, params);
  },

  async getTrack(providerTrackId) {
    return CATALOG.find((t) => t.providerTrackId === providerTrackId) ?? null;
  },

  async getTrending(params) {
    return paginate(CATALOG.slice(0, 12), params);
  },

  async getPopular(params) {
    return paginate([...CATALOG].slice(6, 18), params);
  },

  async getFeatured(params) {
    return paginate(CATALOG.filter((_, i) => i % 5 === 0), params);
  },

  async getCategories() {
    return GENRES;
  },

  async getByCategory(categoryId, params) {
    const genre = GENRES.find((g) => g.id === categoryId);
    if (!genre) return {items: []};
    return paginate(
      CATALOG.filter((t) => t.genre === genre.label),
      params,
    );
  },
};
