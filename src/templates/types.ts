/**
 * Normalized template shape — mirrors functions/src/sounds/types.ts's
 * pattern exactly. The ONLY shape ever sent to the client; provider-
 * specific structures never leak past the adapter.
 */
export type TemplateCategory =
  | 'cinematic'
  | 'retro'
  | 'travel'
  | 'birthday'
  | 'celebration'
  | 'gistoneer';

export type MediaSlotType = 'photo' | 'video';

export interface TemplateMediaSlot {
  id: string;
  type: MediaSlotType;
  required: boolean;
}

export interface TemplateTextPlaceholder {
  id: string;
  defaultText: string;
  maxLength: number;
  xFraction: number;
  yFraction: number;
  fontSize: number;
  color: string;
  /** ms */
  startTimeMs: number;
  /** ms */
  endTimeMs: number;
}

export type TemplateMusicSource = 'CATALOG' | 'LOCAL';

export interface TemplateMusicRef {
  source: TemplateMusicSource;
  trackId: string;
  /** Only present for source: 'CATALOG' — a real Module 5 mock-catalog providerTrackId. */
  providerTrackId?: string;
  title: string;
  artist?: string;
  /** ms */
  startOffsetMs: number;
  /** 0..1 */
  volume: number;
}

export interface GistoneerTemplate {
  id: string;
  title: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  thumbnailUrl?: string;
  mediaSlots: TemplateMediaSlot[];
  /** References a real Module 2 PHOTO_FILTERS id — null/undefined = no filter. */
  filterId?: string;
  textPlaceholders: TemplateTextPlaceholder[];
  musicRef?: TemplateMusicRef;
  schemaVersion: number;
  /** Mock seed + real Firestore-tracked increments — see templates/service.ts. */
  usageCount: number;
  favoriteCount: number;
  isAvailable: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

export interface TemplateProviderAdapter {
  id: string;
  search(query: string, params?: PageParams): Promise<Page<GistoneerTemplate>>;
  getTemplate(templateId: string): Promise<GistoneerTemplate | null>;
  getTrending(params?: PageParams): Promise<Page<GistoneerTemplate>>;
  getFeatured(params?: PageParams): Promise<Page<GistoneerTemplate>>;
  getCategories(): Promise<{id: TemplateCategory; label: string}[]>;
  getByCategory(category: TemplateCategory, params?: PageParams): Promise<Page<GistoneerTemplate>>;
}
