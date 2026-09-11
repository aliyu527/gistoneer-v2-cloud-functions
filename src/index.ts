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
