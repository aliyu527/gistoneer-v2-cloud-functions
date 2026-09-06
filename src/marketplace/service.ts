import {db} from '../admin';

export interface MarketplaceCategory {
  id: string;
  label: string;
}

/**
 * A small, fixed, hardcoded list — matches the scope of the sound-genre
 * precedent (SoundCategory) rather than a full category-management CMS.
 * Shared by mobile (category picker) and admin (filter dropdown).
 */
export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  {id: 'fashion', label: 'Fashion & Accessories'},
  {id: 'electronics', label: 'Electronics'},
  {id: 'home', label: 'Home & Living'},
  {id: 'beauty', label: 'Beauty & Personal Care'},
  {id: 'food', label: 'Food & Groceries'},
  {id: 'design', label: 'Design & Creative'},
  {id: 'photography', label: 'Photography & Video'},
  {id: 'development', label: 'Development & Tech'},
  {id: 'tutoring', label: 'Tutoring & Education'},
  {id: 'repairs', label: 'Repairs & Trade Skills'},
  {id: 'other', label: 'Other'},
];

const CATEGORY_IDS = new Set(MARKETPLACE_CATEGORIES.map((c) => c.id));

export function isValidCategory(id: unknown): id is string {
  return typeof id === 'string' && CATEGORY_IDS.has(id);
}

/** Looks up a mediaUploads record and verifies it belongs to this user and finished uploading — never trusts client-supplied storageKey/url/bucket directly. Mirrors createPost.ts's own local verifyUpload (duplicated, not shared, matching this codebase's existing convention of a small per-file copy rather than a cross-cutting lib for this one helper). */
export async function verifyUpload(uploadId: string, uid: string) {
  const snap = await db.collection('mediaUploads').doc(uploadId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (data.uid !== uid || data.status !== 'uploaded') return null;
  return data as {
    mediaType: 'image' | 'video' | 'audio';
    mimeType: string;
    fileSize: number;
    storageKey: string;
    bucket: string;
    region: string;
  };
}

/**
 * Cascades a vendor's status onto the denormalized `vendorStatus` field of
 * every listing they own — the only way to keep "suspended vendor's listings
 * stop being publicly visible" true, since Firestore rules/queries can't
 * join a listing to its vendor's live status. Bounded to one vendor's own
 * listings (never platform-wide), same BulkWriter technique as Module 08's
 * bulk notification send.
 */
export async function cascadeVendorStatusToListings(vendorId: string, vendorStatus: 'approved' | 'suspended'): Promise<void> {
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => error.failedAttempts < 3);

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('listings').where('vendorId', '==', vendorId).orderBy('__name__').limit(500);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      bulkWriter.update(doc.ref, {vendorStatus});
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 500) break;
  }

  await bulkWriter.close();
}
