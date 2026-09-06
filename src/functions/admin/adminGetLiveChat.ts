import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {clampLimit} from '../../lib/pagination';
import {requireActiveAdmin} from './requireActiveAdmin';

export interface AdminLiveChatMessage {
  id: string;
  authorId: string;
  author: {username: string | null; displayName: string | null; avatarUrl: string | null};
  text: string;
  createdAt: string | null;
  deleted: boolean;
}

interface AdminGetLiveChatRequest {
  liveId: string;
  pageSize?: number;
  cursor?: string;
}

interface AdminGetLiveChatResponse {
  messages: AdminLiveChatMessage[];
  nextCursor: string | null;
}

/**
 * Admin sees deleted messages too (marked, not hidden) — moderation review
 * needs the full picture; the narrowing rule that hides deleted messages
 * from regular clients doesn't apply here since this bypasses rules via the
 * Admin SDK, same as every other admin read function.
 */
export const adminGetLiveChat = onCall<AdminGetLiveChatRequest, Promise<AdminGetLiveChatResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'live.read');

  const liveId = request.data?.liveId;
  if (typeof liveId !== 'string' || liveId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing liveId.');
  }
  const pageSize = clampLimit(request.data?.pageSize, 50, 20);
  const cursor = request.data?.cursor;

  let q = db.collection('liveSessions').doc(liveId).collection('messages').orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(pageSize);

  if (cursor) {
    const cursorSnap = await db.collection('liveSessions').doc(liveId).collection('messages').doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap.get('createdAt'), cursorSnap.id);
    }
  }

  const snap = await q.get();
  const messages: AdminLiveChatMessage[] = snap.docs.map((doc) => {
    const data = doc.data();
    const author = (data.author as Record<string, unknown>) ?? {};
    return {
      id: doc.id,
      authorId: (data.authorId as string) ?? '',
      author: {
        username: (author.username as string) ?? null,
        displayName: (author.displayName as string) ?? null,
        avatarUrl: (author.avatarUrl as string) ?? null,
      },
      text: (data.text as string) ?? '',
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      deleted: Boolean(data.deleted),
    };
  });
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

  return {messages, nextCursor};
});
