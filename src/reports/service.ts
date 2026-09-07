import {db} from '../admin';

export type ReportTargetType = 'user' | 'post' | 'comment' | 'sound' | 'live' | 'vendor' | 'listing';

/**
 * The only report-reason taxonomy that has ever existed in this product —
 * promoted verbatim from the previously-dummy mobile ReportScreen's
 * DummyData.ReportData (13 items), with a handful of obvious typos fixed
 * ("Frauds & Scams" kept as-is; "Pornograpy"→"Pornography",
 * "Harrashment"→"Harassment", "Intelectual"→"Intellectual",
 * "contents"→"content"). Used identically for every reportable entity type,
 * mirroring how VENDOR_REJECTION_REASONS/LISTING_MODERATION_REASONS are
 * flat string arrays shared between mobile and admin — "Other" is the
 * catch-all that requires a free-text description.
 */
export const REPORT_REASONS = [
  'Dangerous organizations/individuals',
  'Frauds & Scams',
  'Misleading Information',
  'Illegal activities or regulated goods',
  'Violent & graphic content',
  'Animal Cruelty',
  'Pornography & nudity',
  'Hate Speech',
  'Harassment or bullying',
  'Intellectual property infringement',
  'Spam',
  'Minor Safety',
  'Other',
];

export function isValidReason(reason: unknown): reason is string {
  return typeof reason === 'string' && REPORT_REASONS.includes(reason);
}

export interface ReportTargetSnapshot {
  label: string;
  ownerId?: string;
}

/**
 * Resolves the real, current entity so submitReport never trusts a
 * client-supplied label/owner — mirrors the "never trust client metadata"
 * posture used everywhere else in this codebase (e.g. Marketplace's
 * verifyUpload). Returns null when the target doesn't exist (or, for a
 * post, isn't published) so the caller can reject the report cleanly.
 */
export async function resolveTargetSnapshot(
  targetType: ReportTargetType,
  targetId: string,
  context?: {postId?: string},
): Promise<ReportTargetSnapshot | null> {
  switch (targetType) {
    case 'user': {
      const snap = await db.collection('users').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {label: data.username ? `@${data.username}` : (data.displayName as string) || targetId, ownerId: targetId};
    }
    case 'post': {
      const snap = await db.collection('posts').doc(targetId).get();
      if (!snap.exists || snap.data()?.status !== 'published') return null;
      const data = snap.data()!;
      const caption = (data.caption as string)?.trim();
      return {label: caption ? caption.slice(0, 80) : '(no caption)', ownerId: data.authorId as string};
    }
    case 'comment': {
      const postId = context?.postId;
      if (!postId) return null;
      const snap = await db.collection('posts').doc(postId).collection('comments').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      const text = (data.text as string)?.trim();
      return {label: text ? text.slice(0, 80) : '(empty comment)', ownerId: data.authorId as string};
    }
    case 'sound': {
      const snap = await db.collection('sounds').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {label: (data.title as string) || 'Untitled sound', ownerId: data.ownerId as string};
    }
    case 'live': {
      const snap = await db.collection('liveSessions').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {label: (data.title as string) || 'Live session', ownerId: data.hostId as string};
    }
    case 'vendor': {
      const snap = await db.collection('vendors').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {label: (data.shopName as string) || 'Vendor', ownerId: targetId};
    }
    case 'listing': {
      const snap = await db.collection('listings').doc(targetId).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {label: (data.title as string) || 'Listing', ownerId: data.vendorId as string};
    }
    default:
      return null;
  }
}
