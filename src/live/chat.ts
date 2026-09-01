import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {enforceRateLimit} from '../lib/rateLimit';

const MAX_MESSAGE_LENGTH = 300;

interface LiveMessageAuthor {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface LiveChatMessage {
  id: string;
  authorId: string;
  author: LiveMessageAuthor;
  text: string;
  createdAt: string;
}

function buildAuthor(userData: FirebaseFirestore.DocumentData): LiveMessageAuthor {
  const author: LiveMessageAuthor = {};
  if (userData.username) author.username = userData.username;
  if (userData.displayName) author.displayName = userData.displayName;
  if (userData.photoURL) author.avatarUrl = userData.photoURL;
  return author;
}

/**
 * Server-written, unlike the reference Brekete implementation's direct
 * client addDoc — mirrors createComment's posture (never trust a client
 * write directly). Rate-limited (createComment's own enforceRateLimit,
 * looser window since live chat is faster back-and-forth than post
 * comments) and length-capped — Brekete has neither. Messages are
 * immutable once posted (no edit/delete), same as post comments and
 * matching Brekete's own "allow update, delete: if false" posture, just
 * now actually rate-limited getting there.
 */
export async function sendLiveMessage(uid: string, liveId: string, text: string): Promise<LiveChatMessage> {
  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) {
    throw new HttpsError('invalid-argument', 'Message cannot be empty.');
  }

  const liveSnap = await db.collection('liveSessions').doc(liveId).get();
  if (!liveSnap.exists || liveSnap.data()!.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This live is no longer available.');
  }

  await enforceRateLimit(uid, 'sendLiveMessage', {maxPerWindow: 60, windowMs: 5 * 60 * 1000});

  const userSnap = await db.collection('users').doc(uid).get();
  const author = buildAuthor(userSnap.data() ?? {});

  const ref = await db
    .collection('liveSessions')
    .doc(liveId)
    .collection('messages')
    .add({authorId: uid, author, text: trimmed, createdAt: FieldValue.serverTimestamp()});

  return {id: ref.id, authorId: uid, author, text: trimmed, createdAt: new Date().toISOString()};
}
