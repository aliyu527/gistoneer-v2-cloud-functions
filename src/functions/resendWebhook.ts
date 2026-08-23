import {onRequest} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {verifySvixSignature} from '../lib/svixVerify';
import {RESEND_WEBHOOK_SECRET} from '../config';

const SUPPRESSING_EVENTS = new Set(['email.bounced', 'email.complained']);

interface ResendWebhookEvent {
  type: string;
  data: {
    to?: string[];
    email_id?: string;
  };
}

/**
 * Receives delivery events from Resend so bounces/spam-complaints stop us
 * from repeatedly emailing a dead or complaining address. Configure in the
 * Resend dashboard: Webhooks -> Add Endpoint -> this function's URL ->
 * select at least "email.bounced" and "email.complained" -> copy the
 * Signing Secret into RESEND_WEBHOOK_SECRET.
 */
export const resendWebhook = onRequest(
  {cors: false, secrets: [RESEND_WEBHOOK_SECRET]},
  async (request, response) => {
    const svixId = request.header('svix-id');
    const svixTimestamp = request.header('svix-timestamp');
    const svixSignature = request.header('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      response.status(400).send('Missing signature headers');
      return;
    }

    const rawBody = request.rawBody?.toString('utf8') ?? '';
    const valid = verifySvixSignature(
      RESEND_WEBHOOK_SECRET.value(),
      svixId,
      svixTimestamp,
      svixSignature,
      rawBody,
    );

    if (!valid) {
      response.status(401).send('Invalid signature');
      return;
    }

    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      response.status(400).send('Invalid JSON');
      return;
    }

    console.log('Resend webhook event', {type: event.type});

    if (SUPPRESSING_EVENTS.has(event.type)) {
      const recipients = event.data.to ?? [];
      await Promise.all(
        recipients.map((email) =>
          db
            .collection('suppressedEmails')
            .doc(email.toLowerCase())
            .set({reason: event.type, suppressedAt: new Date()}, {merge: true}),
        ),
      );
      // Also stop any in-flight registration code for this address (those
      // are keyed by email). Reset-purpose codes are keyed by uid instead —
      // see verifyEmailVerificationCode — so a bounce during password reset
      // isn't cleaned up here; it just expires on its own 10-minute TTL.
      await Promise.all(
        recipients.map((email) => db.collection('emailVerifications').doc(email.toLowerCase()).delete()),
      );
    }

    response.status(200).send('ok');
  },
);
