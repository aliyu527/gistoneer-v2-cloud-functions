import {onCall} from 'firebase-functions/v2/https';
import type {Query, DocumentData} from 'firebase-admin/firestore';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';
import type {AdminRole} from './bootstrapAdmin';

export type AdminAccountStatus = 'active' | 'suspended';

export interface AdminAccountListItem {
  uid: string;
  email: string | null;
  role: AdminRole;
  status: AdminAccountStatus;
  createdAt: string | null;
  lastLoginAt: string | null;
}

interface AdminListAdminsRequest {
  status?: AdminAccountStatus;
  role?: AdminRole;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: string;
}

interface AdminListAdminsResponse {
  admins: AdminAccountListItem[];
  nextCursor: string | null;
}

export function toAdminAccountListItem(doc: FirebaseFirestore.QueryDocumentSnapshot): AdminAccountListItem {
  const data = doc.data();
  return {
    uid: doc.id,
    email: (data.email as string) ?? null,
    role: (data.role as AdminRole) ?? 'support',
    status: (data.status as AdminAccountStatus) ?? 'active',
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    lastLoginAt: data.lastLoginAt?.toDate?.().toISOString() ?? null,
  };
}

/** Same one-filter-at-a-time list shape as every prior list function (status > role priority). First function to ever paginate the admins collection — nothing before Module 12 listed it at all. */
export const adminListAdmins = onCall<AdminListAdminsRequest, Promise<AdminListAdminsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'admins.read');

  const {status, role, sortDir = 'desc', cursor} = request.data ?? {};
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);

  let q: Query<DocumentData> = db.collection('admins');
  if (status) {
    q = q.where('status', '==', status);
  } else if (role) {
    q = q.where('role', '==', role);
  }
  q = q.orderBy('createdAt', sortDir).orderBy('__name__', sortDir).limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('admins').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const admins = snap.docs.map(toAdminAccountListItem);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {admins, nextCursor};
});
