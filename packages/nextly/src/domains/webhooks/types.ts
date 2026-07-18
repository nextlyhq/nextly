/**
 * Webhook domain — pure types.
 *
 * The public delivery contract for the durable-outbox webhook system: the
 * event envelope that ships to endpoints, the endpoint registry shape, and the
 * structured filter spec. These are storage-agnostic; the per-dialect Drizzle
 * tables (`schemas/webhooks/*`) persist them, and the delivery engine (later
 * slices) reads them back. No I/O lives here.
 *
 * @module domains/webhooks/types
 */

/**
 * Canonical webhook event types, grouped by resource. Stable string ids; the
 * envelope's `specversion` (not renames) carries breaking changes. A webhook
 * subscribes to a set of these. Distinct from the internal event-bus names
 * (`document.*`, `collection.<slug>.*`); the bus -> webhook-type mapping is
 * wired in the capture slice.
 */
export const WEBHOOK_EVENT_TYPES = [
  // Entries (per collection).
  "entry.created",
  "entry.updated",
  "entry.deleted",
  "entry.published",
  "entry.unpublished",
  "entry.status_changed",
  // Singles.
  "single.updated",
  "single.published",
  "single.unpublished",
  // Media.
  "media.uploaded",
  "media.updated",
  "media.deleted",
  // Users (opt-in, sensitive; never carries password fields).
  "user.created",
  "user.deleted",
  // Forms (via plugin-form-builder).
  "form.submission.created",
] as const;

/** A canonical webhook event type. */
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Resource families an event can be about. */
export type WebhookResourceKind =
  | "entry"
  | "single"
  | "media"
  | "user"
  | "form";

/** What triggered an event; feeds the audit trail. */
export type WebhookActorType = "user" | "apiKey" | "system";

/**
 * The resource an event is about. Modeled as a discriminated union so the
 * collection invariant is enforced by the type system: an `entry` always
 * carries its collection slug, and every other kind forbids one.
 */
export type WebhookResource =
  | { kind: "entry"; collection: string; id?: string }
  | {
      kind: "single" | "media" | "user" | "form";
      collection?: never;
      id?: string;
    };

/** Who triggered the event. */
export interface WebhookActor {
  type: WebhookActorType;
  id?: string;
}

/**
 * The event envelope delivered to endpoints. One shape for every event: thin
 * identity plus a full `data` section so any current or future filter/consumer
 * has what it needs. Modeled on Standard Webhooks / CloudEvents.
 */
export interface WebhookEvent {
  /** ULID; stable across retries; doubles as the idempotency / webhook-id key. */
  id: string;
  type: WebhookEventType;
  /** Envelope schema version; bumped only on a breaking envelope change. */
  specversion: "1";
  /** Event time (not delivery time), ISO-8601. */
  timestamp: string;
  /** Origin site (from config), for multi-endpoint disambiguation. */
  site?: string;
  resource: WebhookResource;
  /** Current state, with access-denied/secret fields already stripped. */
  data: Record<string, unknown>;
  /** Prior state on update/delete/status-change; null on create. */
  previous: Record<string, unknown> | null;
  /** Top-level keys whose value changed; drives changed-field filtering. */
  changedFields: string[];
  actor?: WebhookActor;
}

/** Lifecycle of one delivery row in the outbox ledger. */
export type DeliveryStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "retrying"
  | "failed";

/**
 * Structured, extensible per-webhook filter. v1 is a plain conjunction of
 * optional constraints; a future expression filter is an additive
 * discriminated member on the same `version` column, so v1 -> v2 needs no
 * migration. Evaluated by the pure `matchesFilter`.
 */
export interface FilterSpecV1 {
  version: 1;
  /** OR across types; absent/empty = every subscribed type matches. */
  eventTypes?: WebhookEventType[];
  /** null/absent = all collections. */
  collections?: string[] | null;
  /** Fire only if any listed field changed; null/absent = no constraint. */
  changedFields?: string[] | null;
}

/** Reserved for the future expression filter (not yet evaluated). */
export interface FilterSpecExpression {
  version: 2;
  type: "expression";
  expr: string;
}

export type FilterSpec = FilterSpecV1 | FilterSpecExpression;

/**
 * The outbound endpoint registry shape (mirrors `nextly_webhooks`). Secrets are
 * never held raw: `secretHash` is the list of active-secret hashes (a list for
 * zero-downtime rotation) and `secretPrefix` is a display-only prefix. The
 * property name matches the Drizzle column so a hydrated row maps directly.
 */
export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Subscribed event types. */
  eventTypes: WebhookEventType[];
  /** Structured filter, or null for "match every subscribed type". */
  filter: FilterSpec | null;
  /** Static request headers merged into every delivery. */
  headers: Record<string, string> | null;
  /** List of active signing-secret hashes (list-shaped for rotation). */
  secretHash: string[];
  secretPrefix: string;
  /** Reserved per-endpoint field projection; not applied yet. */
  fieldAllowlist: string[] | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
