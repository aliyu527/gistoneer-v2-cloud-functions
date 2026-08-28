import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../admin';
import {getActiveProvider} from './providerRegistry';
import type {GistoneerTemplate, Page, PageParams, TemplateCategory} from './types';

/**
 * The mock catalog's usageCount/favoriteCount are a static seed (spec §66/
 * §165's "do not fabricate metrics" is honored by layering REAL, ongoing
 * Firestore increments on top rather than ever growing the fake number
 * itself). templateUsage/{templateId} is the only source of truth for the
 * real portion.
 */
async function withRealCounts(template: GistoneerTemplate): Promise<GistoneerTemplate> {
  const snap = await db.collection('templateUsage').doc(template.id).get();
  const data = snap.data();
  return {
    ...template,
    usageCount: template.usageCount + (data?.usageCount ?? 0),
    favoriteCount: template.favoriteCount + (data?.favoriteCount ?? 0),
  };
}

async function withRealCountsMany(templates: GistoneerTemplate[]): Promise<GistoneerTemplate[]> {
  return Promise.all(templates.map(withRealCounts));
}

export async function searchTemplates(query: string, params?: PageParams): Promise<Page<GistoneerTemplate>> {
  const page = await getActiveProvider().search(query, params);
  return {...page, items: await withRealCountsMany(page.items)};
}

export async function getTemplateDetail(templateId: string): Promise<GistoneerTemplate | null> {
  const template = await getActiveProvider().getTemplate(templateId);
  return template ? withRealCounts(template) : null;
}

export async function getTemplatesByCategory(category: TemplateCategory, params?: PageParams): Promise<Page<GistoneerTemplate>> {
  const page = await getActiveProvider().getByCategory(category, params);
  return {...page, items: await withRealCountsMany(page.items)};
}

export async function getCatalogHome(): Promise<{
  featured: GistoneerTemplate[];
  trending: GistoneerTemplate[];
  categories: {id: TemplateCategory; label: string}[];
}> {
  const provider = getActiveProvider();
  const [featured, trending, categories] = await Promise.all([
    provider.getFeatured({limit: 10}),
    provider.getTrending({limit: 10}),
    provider.getCategories(),
  ]);
  return {
    featured: await withRealCountsMany(featured.items),
    trending: await withRealCountsMany(trending.items),
    categories,
  };
}

/** Fire-and-forget from the callable's perspective — a missed increment isn't worth failing the caller over. */
export async function recordUsage(templateId: string): Promise<void> {
  await db.collection('templateUsage').doc(templateId).set({usageCount: FieldValue.increment(1)}, {merge: true});
}

/** Idempotent — a retried favorite call never double-counts (mirrors confirmMediaUpload's own idempotency posture). */
export async function favoriteTemplate(uid: string, templateId: string): Promise<void> {
  const favRef = db.collection('templateFavorites').doc(`${uid}_${templateId}`);
  const existing = await favRef.get();
  if (existing.exists) return;
  await favRef.set({uid, templateId, createdAt: FieldValue.serverTimestamp()});
  await db.collection('templateUsage').doc(templateId).set({favoriteCount: FieldValue.increment(1)}, {merge: true});
}

export async function unfavoriteTemplate(uid: string, templateId: string): Promise<void> {
  const favRef = db.collection('templateFavorites').doc(`${uid}_${templateId}`);
  const existing = await favRef.get();
  if (!existing.exists) return;
  await favRef.delete();
  await db.collection('templateUsage').doc(templateId).set({favoriteCount: FieldValue.increment(-1)}, {merge: true});
}

export async function getFavoriteTemplates(uid: string): Promise<GistoneerTemplate[]> {
  const snap = await db.collection('templateFavorites').where('uid', '==', uid).get();
  const ids = snap.docs.map((d) => d.data().templateId as string);
  const templates = await Promise.all(ids.map((id) => getActiveProvider().getTemplate(id)));
  return withRealCountsMany(templates.filter((t): t is GistoneerTemplate => t !== null));
}

export async function isFavorited(uid: string, templateId: string): Promise<boolean> {
  const snap = await db.collection('templateFavorites').doc(`${uid}_${templateId}`).get();
  return snap.exists;
}
