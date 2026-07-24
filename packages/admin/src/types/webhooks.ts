/**
 * Webhook UI types.
 *
 * These mirror the backend contract in
 * `packages/nextly/src/domains/webhooks/**` but are typed for the wire:
 * timestamps arrive as ISO strings, and no summary shape carries the signing
 * secret or a header value (header values read back redacted). The one
 * exception is `CreatedWebhook.secret`, returned exactly once on create.
 */

/** Every event an endpoint can subscribe to (mirrors `WEBHOOK_EVENT_TYPES`). */
export const WEBHOOK_EVENT_TYPES = [
  "entry.created",
  "entry.updated",
  "entry.deleted",
  "entry.published",
  "entry.unpublished",
  "entry.status_changed",
  "single.updated",
  "single.published",
  "single.unpublished",
  "media.uploaded",
  "media.updated",
  "media.deleted",
  "user.created",
  "user.deleted",
  "form.submission.created",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Subscribe to every current and future event. Must be used alone. */
export const WEBHOOK_EVENT_WILDCARD = "*" as const;

export type WebhookEventSubscription =
  | WebhookEventType
  | typeof WEBHOOK_EVENT_WILDCARD;

/** The sentinel a redacted header value reads back as; never sent on write. */
export const REDACTED_HEADER_VALUE = "<redacted>";

/**
 * Endpoint summary returned by list and get. Carries no secret or ciphertext;
 * static header values are redacted to `REDACTED_HEADER_VALUE` (names survive).
 */
export interface WebhookEndpointSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes: WebhookEventSubscription[];
  headers: Record<string, string> | null;
  /** Display-only prefix of the signing secret. */
  secretPrefix: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  eventTypes: WebhookEventSubscription[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
}

/** All optional; at least one key. `headers: null` clears, `undefined` leaves. */
export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  eventTypes?: WebhookEventSubscription[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
}

/** Created endpoint plus its one-time signing secret (shown once). */
export interface CreatedWebhook {
  doc: WebhookEndpointSummary;
  secret: string;
}

/** Result of a connectivity test-ping. */
export interface WebhookTestResult {
  delivered: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  responseSnippet?: string;
}

/**
 * Lifecycle state of a delivery, mirroring the drain's status vocabulary
 * (`packages/nextly/src/domains/webhooks`). These are the only values the list
 * status filter offers.
 */
export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "retrying",
  "failed",
] as const;

export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** The resource an event was about, surfaced from the joined event row. */
export interface WebhookDeliveryResource {
  kind: string;
  collection: string | null;
  id: string | null;
  /** Which translation changed, for a localized resource; null otherwise. */
  locale: string | null;
}

/**
 * One recorded delivery attempt. `outcome` is free text from the engine (e.g.
 * `delivered`, `retrying`, `failed`) rather than the delivery-level status set,
 * so it is typed as a string, not `WebhookDeliveryStatus`.
 */
export interface WebhookDeliveryAttempt {
  at: string;
  outcome: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

/**
 * A delivery as the log list shows it (joined to its event). Timestamps arrive
 * as ISO-8601 UTC strings: the delivery reads opt out of server-side timezone
 * rewriting so opaque captured text (errors, snippets) survives verbatim, so
 * the client renders these instants itself.
 */
export interface WebhookDeliverySummary {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  resource: WebhookDeliveryResource;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** When the next retry is due, or null when the delivery is terminal. */
  nextAttemptAt: string | null;
  /** When the underlying event was recorded. */
  eventCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A single delivery with its full attempt history and last response snippet. */
export interface WebhookDeliveryDetail extends WebhookDeliverySummary {
  attempts: WebhookDeliveryAttempt[];
  /** Truncated response body from the last attempt, or null. */
  lastResponseSnippet: string | null;
}

/** Filters and paging for a delivery list request. `page`/`limit` are 1-based. */
export interface ListDeliveriesParams {
  page?: number;
  limit?: number;
  status?: WebhookDeliveryStatus;
  eventType?: string;
}

/**
 * Summary of one manual/scheduled drain pass (the `item` of the drain mutation
 * envelope). Mirrors the backend `RunDrainResult`.
 */
export interface RunDrainResult {
  rounds: number;
  eventsProcessed: number;
  deliveriesCreated: number;
  attempted: number;
  delivered: number;
  retried: number;
  failed: number;
  abandoned: number;
  pruned: { events: number; deliveries: number };
}
