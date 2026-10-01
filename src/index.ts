/**
 * The 152 request/response Cloud Functions this project used to export have
 * all been migrated to the new Node.js API (api-es6) — see that project's
 * src/routes/ for the full current surface, and the migration's own module
 * roadmap for what mapped where. They were undeployed and removed here on
 * 2026-09-11.
 *
 * These 3 remain, deliberately: each is an onRequest webhook called
 * directly by a third-party's own servers (Agora, Resend), whose dashboards
 * still point at these functions' URLs. api-es6 has equivalent routes
 * (/api/v1/live/webhooks/*, /api/v1/webhooks/resend) but isn't deployed
 * anywhere publicly reachable yet — deleting these now would mean real
 * Agora/Resend events go nowhere. Revisit once api-es6 is deployed and
 * those dashboards are repointed.
 */
export {resendWebhook} from './functions/resendWebhook';
export {onMediaGatewayEvent} from './functions/live/onMediaGatewayEvent';
export {onRecordingEvent} from './functions/live/onRecordingEvent';

/**
 * Unrelated to the migration above — a genuinely new scheduled function,
 * the first onSchedule/cron-style function in this codebase. Hard-deletes
 * accounts whose Delete Account 30-day grace period has passed; see its
 * own doc comment for the full picture (api-es6 accountLifecycleService.js
 * owns the request/cancel side).
 */
export {purgeScheduledDeletions} from './functions/users/purgeScheduledDeletions';

/**
 * Stage 3 (push notifications) — the first Firestore-document trigger
 * this codebase has ever had. See the function's own doc comment for why
 * this specific path (chat messages) is the one exception to the
 * everything-flows-through-api-es6 posture every other notification type
 * already follows (createNotification.js, inline, no trigger needed).
 */
export {onConversationUpdated} from './functions/chat/onConversationUpdated';
