/**
 * Webhook domain — public barrel.
 *
 * Pure envelope + filter primitives shared by the capture and delivery slices.
 *
 * @module domains/webhooks
 */

export { buildEnvelope, type BuildEnvelopeInput } from "./envelope";
export { matchesFilter } from "./filter";
export { recordEvent } from "./record-event";
export {
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "./endpoint-registry";
export {
  selectDeliveryTargets,
  fanOutDueEvents,
  type FanOutDeps,
  type FanOutDatabase,
  type FanOutTx,
  type FanOutLogger,
  type FanOutResult,
} from "./fan-out";
export {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "./sensitive-fields";
export {
  signPayload,
  buildSignatureHeaders,
  verifySignature,
  WEBHOOK_ID_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type SignInput,
  type SignHeadersInput,
  type VerifyInput,
} from "./signing";
export {
  classifyResponse,
  nextAttemptDelayMs,
  decideDelivery,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  type AttemptOutcome,
  type BackoffOptions,
  type DeliveryDecision,
  type DecideDeliveryInput,
} from "./delivery-policy";
export {
  deliverDueDeliveries,
  type DeliverDeps,
  type DeliverDatabase,
  type DeliverTx,
  type DeliverLogger,
  type DeliverTransport,
  type DeliverResult,
} from "./deliver";
export { runDrain, type RunDrainDeps, type RunDrainResult } from "./run-drain";
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
