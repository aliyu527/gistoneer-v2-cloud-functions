import {onDocumentUpdated} from 'firebase-functions/v2/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {logger} from 'firebase-functions';
import {db} from '../../admin';

const messaging = getMessaging();

interface ChatParticipant {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface ConversationData {
  type?: 'group';
  name?: string;
  participantIds: string[];
  participants: Record<string, ChatParticipant>;
  unreadCount: Record<string, number>;
  lastMessage: string;
  lastMessageAt: unknown;
  lastMessageSenderId: string;
}

/**
 * Stage 3 — the FIRST Firestore-document trigger this codebase has ever
 * had (see this file's own plan entry for why: mobile.beta's
 * chatService.ts sendMessage/sendGroupMessage are genuine CLIENT-direct
 * Firestore writes, never an api-es6 request, so there's no
 * request-handling code anywhere to hook a push send into the way
 * createNotification.js does for every other notification type).
 *
 * Fires on every conversations/{id} write; only acts when lastMessageAt
 * actually changed AND lastMessageSenderId is present — that pair is
 * exactly what sendMessage/sendGroupMessage touch on every real send and
 * nothing else touches (Stage 2's admin-management/membership updates
 * never set lastMessageAt), so a group rename/add-member/promote never
 * false-triggers a push. Covers 1:1 and group conversations identically
 * since both live in this same collection/shape (Stage 2).
 */
export const onConversationUpdated = onDocumentUpdated('conversations/{conversationId}', async (event) => {
  if (!event.data) return;
  const before = event.data.before.data() as ConversationData;
  const after = event.data.after.data() as ConversationData;

  const beforeAt = (before.lastMessageAt as {toMillis?: () => number} | undefined)?.toMillis?.() ?? 0;
  const afterAt = (after.lastMessageAt as {toMillis?: () => number} | undefined)?.toMillis?.() ?? 0;
  if (afterAt <= beforeAt || !after.lastMessageSenderId) return;

  const senderId = after.lastMessageSenderId;
  const sender = after.participants?.[senderId];
  const senderName = sender?.displayName || (sender?.username ? `@${sender.username}` : 'Someone');
  const isGroup = after.type === 'group';
  const recipientIds = (after.participantIds || []).filter((uid) => uid !== senderId);
  if (recipientIds.length === 0) return;

  const tokensSnap = await db.collection('pushTokens').where('uid', 'in', recipientIds.slice(0, 30)).get();
  if (tokensSnap.empty) return;

  const title = isGroup ? after.name || 'Group' : senderName;
  const body = isGroup ? `${senderName}: ${after.lastMessage}` : after.lastMessage;

  const result = await messaging.sendEachForMulticast({
    tokens: tokensSnap.docs.map((d) => d.data().token as string),
    notification: {title, body},
    data: {
      type: 'message',
      isGroup: String(isGroup),
      conversationId: event.params.conversationId,
      ...(isGroup ? {} : {otherUid: senderId}),
    },
  });

  const staleDocs = tokensSnap.docs.filter((_, i) => {
    const code = result.responses[i].error?.code;
    return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
  });
  await Promise.all(staleDocs.map((d) => d.ref.delete()));

  logger.info('onConversationUpdated: push sent', {conversationId: event.params.conversationId, recipientCount: recipientIds.length, successCount: result.successCount});
});
