/**
 * Webhook domain — public barrel.
 *
 * Pure envelope + filter primitives shared by the capture and delivery slices.
 *
 * @module domains/webhooks
 */

export { buildEnvelope, type BuildEnvelopeInput } from "./envelope";
export { matchesFilter } from "./filter";
export {
  signPayload,
  buildSignatureHeaders,
  verifySignature,
  WEBHOOK_ID_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type SignInput,
  type VerifyInput,
} from "./signing";
export {
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  type WebhookResourceKind,
  type WebhookActorType,
  type WebhookResource,
  type WebhookActor,
  type WebhookEvent,
  type DeliveryStatus,
  type FilterSpec,
  type FilterSpecV1,
  type FilterSpecExpression,
  type WebhookEndpoint,
} from "./types";
