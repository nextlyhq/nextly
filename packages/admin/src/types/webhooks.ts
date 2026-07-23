/**
 * Webhook UI types.
 *
 * These mirror the backend contract in
 * `packages/nextly/src/domains/webhooks/**` but are typed for the wire:
 * timestamps arrive as ISO strings, and no shape here ever carries the
 * signing secret or a header value (header values read back redacted).
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
