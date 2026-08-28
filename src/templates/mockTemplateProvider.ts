import type {GistoneerTemplate, Page, PageParams, TemplateCategory, TemplateProviderAdapter} from './types';

/**
 * DEV ONLY — no real template marketplace exists. This is static
 * server-side data, not a real catalog (mirrors sounds/mockCatalogProvider.ts's
 * own isolation boundary exactly). filterId values are real Module 2
 * PHOTO_FILTERS ids; musicRef.providerTrackId values are real Module 5
 * mock-catalog track ids — genuine cross-references, not decorative. A real
 * provider adapter replaces this file behind the same TemplateProviderAdapter
 * interface without touching providerRegistry.ts, the callables, or the client.
 */
const CATEGORIES: {id: TemplateCategory; label: string}[] = [
  {id: 'cinematic', label: 'Cinematic'},
  {id: 'retro', label: 'Retro'},
  {id: 'travel', label: 'Travel'},
  {id: 'birthday', label: 'Birthday'},
  {id: 'celebration', label: 'Celebration'},
  {id: 'gistoneer', label: 'Gistoneer Originals'},
];

function textPlaceholder(text: string, startTimeMs = 0, endTimeMs = 5000) {
  return {
    id: `ph-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    defaultText: text,
    maxLength: 40,
    xFraction: 0.5,
    yFraction: 0.8,
    fontSize: 28,
    color: '#FFFFFF',
    startTimeMs,
    endTimeMs,
  };
}

function musicRef(providerTrackId: string, title: string, artist: string, volume = 0.8) {
  return {source: 'CATALOG' as const, trackId: providerTrackId, providerTrackId, title, artist, startOffsetMs: 0, volume};
}

const TEMPLATES: GistoneerTemplate[] = [
  {
    id: 'tmpl-golden-hour', title: 'Golden Hour Story', description: 'Warm cinematic tones for a single standout clip.',
    category: 'cinematic', tags: ['cinematic', 'warm', 'story'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'cinema', textPlaceholders: [textPlaceholder('YOUR STORY')],
    musicRef: musicRef('mock-1', 'Golden Hour', 'Lumen'),
    schemaVersion: 1, usageCount: 1240, favoriteCount: 312, isAvailable: true,
  },
  {
    id: 'tmpl-night-drive', title: 'Night Drive', description: 'Moody, dramatic contrast for after-dark clips.',
    category: 'cinematic', tags: ['cinematic', 'moody', 'night'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'dramatic', textPlaceholders: [textPlaceholder('2026')],
    schemaVersion: 1, usageCount: 860, favoriteCount: 190, isAvailable: true,
  },
  {
    id: 'tmpl-old-film', title: 'Old Film', description: 'Vintage grain and warmth, like an old home movie.',
    category: 'retro', tags: ['retro', 'vintage', 'film'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'vintage', textPlaceholders: [textPlaceholder('MEMORIES')],
    musicRef: musicRef('mock-5', 'Higher', 'DJ Tempo'),
    schemaVersion: 1, usageCount: 2010, favoriteCount: 540, isAvailable: true,
  },
  {
    id: 'tmpl-vhs-nights', title: 'VHS Nights', description: 'Faded retro look for a single photo.',
    category: 'retro', tags: ['retro', 'vhs', 'faded'],
    mediaSlots: [{id: 'slot-1', type: 'photo', required: true}],
    filterId: 'fade', textPlaceholders: [textPlaceholder('REWIND')],
    schemaVersion: 1, usageCount: 430, favoriteCount: 88, isAvailable: false,
  },
  {
    id: 'tmpl-wanderlust', title: 'Wanderlust', description: 'Vivid colors for a 3-clip travel montage.',
    category: 'travel', tags: ['travel', 'vivid', 'montage'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}, {id: 'slot-2', type: 'video', required: true}, {id: 'slot-3', type: 'video', required: true}],
    filterId: 'vivid', textPlaceholders: [textPlaceholder('YOUR ADVENTURE')],
    musicRef: musicRef('mock-9', 'Sunday Groove', 'Oja'),
    schemaVersion: 1, usageCount: 1680, favoriteCount: 402, isAvailable: true,
  },
  {
    id: 'tmpl-passport-stamps', title: 'Passport Stamps', description: 'Warm tones for a 5-photo travel recap.',
    category: 'travel', tags: ['travel', 'photos', 'recap'],
    mediaSlots: Array.from({length: 5}, (_, i) => ({id: `slot-${i + 1}`, type: 'photo' as const, required: true})),
    filterId: 'warm', textPlaceholders: [textPlaceholder('NEXT STOP')],
    schemaVersion: 1, usageCount: 720, favoriteCount: 165, isAvailable: true,
  },
  {
    id: 'tmpl-birthday-bash', title: 'Birthday Bash', description: 'Soft portrait tones for your birthday clip.',
    category: 'birthday', tags: ['birthday', 'party'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'portrait', textPlaceholders: [textPlaceholder('HAPPY BIRTHDAY')],
    musicRef: musicRef('mock-13', 'Fever Dream', 'Nova Sound'),
    schemaVersion: 1, usageCount: 3120, favoriteCount: 890, isAvailable: true,
  },
  {
    id: 'tmpl-cake-candles', title: 'Cake & Candles', description: 'Two warm birthday photos, side by side in time.',
    category: 'birthday', tags: ['birthday', 'cake'],
    mediaSlots: [{id: 'slot-1', type: 'photo', required: true}, {id: 'slot-2', type: 'photo', required: true}],
    filterId: 'warm', textPlaceholders: [textPlaceholder('MAKE A WISH')],
    schemaVersion: 1, usageCount: 540, favoriteCount: 120, isAvailable: true,
  },
  {
    id: 'tmpl-celebration-time', title: 'Celebration Time', description: 'Vivid energy for any celebration clip.',
    category: 'celebration', tags: ['celebration', 'party', 'vivid'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'vivid', textPlaceholders: [textPlaceholder('CHEERS')],
    musicRef: musicRef('mock-17', 'Neon Rain', 'Vess'),
    schemaVersion: 1, usageCount: 990, favoriteCount: 210, isAvailable: true,
  },
  {
    id: 'tmpl-milestone', title: 'Milestone', description: 'Cool tones across two clips for a big moment.',
    category: 'celebration', tags: ['celebration', 'milestone'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}, {id: 'slot-2', type: 'video', required: true}],
    filterId: 'cool', textPlaceholders: [textPlaceholder('WE DID IT')],
    schemaVersion: 1, usageCount: 610, favoriteCount: 140, isAvailable: true,
  },
  {
    id: 'tmpl-gistoneer-original', title: 'Gistoneer Original', description: 'Our signature original look, no filter needed.',
    category: 'gistoneer', tags: ['gistoneer', 'original'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    textPlaceholders: [textPlaceholder('MADE WITH GISTONEER')],
    musicRef: musicRef('mock-21', 'Backroad', 'Marlow'),
    schemaVersion: 1, usageCount: 1450, favoriteCount: 380, isAvailable: true,
  },
  {
    id: 'tmpl-teal-vibes', title: 'Teal Vibes', description: 'Cool teal-leaning tones — the Gistoneer color, on your clip.',
    category: 'gistoneer', tags: ['gistoneer', 'teal', 'cool'],
    mediaSlots: [{id: 'slot-1', type: 'video', required: true}],
    filterId: 'cool', textPlaceholders: [textPlaceholder('GISTONEER')],
    schemaVersion: 1, usageCount: 2340, favoriteCount: 610, isAvailable: true,
  },
];

function paginate(items: GistoneerTemplate[], params?: PageParams): Page<GistoneerTemplate> {
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 50);
  const offset = params?.cursor ? Math.max(0, parseInt(params.cursor, 10) || 0) : 0;
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {items: slice, nextCursor: nextOffset < items.length ? String(nextOffset) : undefined};
}

export const mockTemplateProvider: TemplateProviderAdapter = {
  id: 'mock',

  async search(query, params) {
    const q = query.trim().toLowerCase();
    if (!q) return {items: []};
    const matches = TEMPLATES.filter(
      (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some((tag) => tag.includes(q)),
    );
    return paginate(matches, params);
  },

  async getTemplate(templateId) {
    return TEMPLATES.find((t) => t.id === templateId) ?? null;
  },

  async getTrending(params) {
    return paginate([...TEMPLATES].sort((a, b) => b.usageCount - a.usageCount).slice(0, 10), params);
  },

  async getFeatured(params) {
    return paginate(TEMPLATES.filter((_, i) => i % 3 === 0), params);
  },

  async getCategories() {
    return CATEGORIES;
  },

  async getByCategory(category, params) {
    return paginate(TEMPLATES.filter((t) => t.category === category), params);
  },
};
