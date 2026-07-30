/**
 * Webhook domain — recording-policy normalizer.
 *
 * Normalizes a collection/single's `webhooks` option into one resolved shape so
 * every consumer reads `{ record, emit? }` and never branches on the raw
 * `boolean | { record?, emit? }` union. Mirrors
 * `domains/versions/resolve-config.ts`: the raw option is author-facing sugar;
 * the resolved shape is what the runtime reads.
 *
 * @module domains/webhooks/resolve-recording-config
 */

import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_RESOURCE_KINDS,
  type WebhookEventType,
  type WebhookResourceKind,
} from "./types";

/**
 * A curated event a collection emits in place of its default `entry.*` event.
 * Used by a PII collection (with `record: false`) to notify subscribers of a
 * new row while shipping only allowlisted metadata.
 */
export interface ResolvedWebhookEmit {
  /** The event type to record, e.g. `"form.submission.created"`. */
  event: WebhookEventType;
  /**
   * Resource family, derived from the event's first segment (`form.*` → `form`).
   * Never `entry` or `single`: those kinds are gated by a per-entity recording
   * policy keyed by slug, so a curated event of that kind on a collection would
   * be suppressed — by this collection's own opt-out (`entry`) or by an
   * unrelated Single that shares the slug (`single`). Rejected upstream, leaving
   * the ungated families (`media`/`user`/`form`).
   */
  kind: Exclude<WebhookResourceKind, "entry" | "single">;
  /** Allowlist of document keys copied into the payload; default-deny. */
  fields?: readonly string[];
}

/** The resolved webhook recording policy for one collection/single. */
export interface ResolvedWebhookRecording {
  /** Whether the default `entry.*`/`single.*` events are recorded. */
  record: boolean;
  /** A curated metadata-only event to emit on create, when configured. */
  emit?: ResolvedWebhookEmit;
}

/**
 * The raw author-facing option, widened to tolerate untyped JS configs so a
 * malformed value is normalized rather than throwing.
 */
type WebhooksOption =
  | boolean
  | { record?: boolean; emit?: { event?: unknown; fields?: unknown } }
  | undefined;

function isWebhookEventType(value: unknown): value is WebhookEventType {
  return (
    typeof value === "string" &&
    (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function isCuratedResourceKind(
  value: string
): value is Exclude<WebhookResourceKind, "entry" | "single"> {
  // Only the ungated families (media/user/form) are valid for a curated
  // collection event: `entry` and `single` are gated by a per-entity recording
  // policy keyed by slug, so a curated `entry.*`/`single.*` would be suppressed
  // by this collection's own opt-out (entry) or by an unrelated Single that
  // shares the slug (single).
  return (
    value !== "entry" &&
    value !== "single" &&
    (WEBHOOK_RESOURCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Resolve a configured `emit` to its canonical shape, or `undefined` when it is
 * absent or malformed. The resource kind is derived from the event's first
 * segment (`form.submission.created` → `form`) and validated, so a curated event
 * lands in the right resource family without the author restating it. A
 * malformed emit (unknown event, non-string field names) is dropped rather than
 * throwing at boot: the default-deny stance keeps a bad config from emitting a
 * bogus or unfiltered event. An `entry.*`/`single.*`-family event is dropped for
 * the same reason it cannot work: a curated event exists to REPLACE the
 * suppressed default events with one that no per-entity opt-out gates, but an
 * entry- or single-kind event is gated by a per-slug policy (this collection's
 * own opt-out, or an unrelated Single sharing the slug) and so would be
 * suppressed and never emit.
 */
function resolveEmit(emit: unknown): ResolvedWebhookEmit | undefined {
  if (typeof emit !== "object" || emit === null) return undefined;
  const { event, fields } = emit as { event?: unknown; fields?: unknown };
  if (!isWebhookEventType(event)) return undefined;
  const derivedKind = event.split(".")[0];
  if (!isCuratedResourceKind(derivedKind)) return undefined;
  const safeFields =
    Array.isArray(fields) && fields.every(f => typeof f === "string")
      ? (fields as readonly string[])
      : undefined;
  return safeFields
    ? { event, kind: derivedKind, fields: safeFields }
    : { event, kind: derivedKind };
}

/**
 * Resolve the `webhooks` option to its canonical shape. The default is to
 * RECORD: an entity that never sets the option keeps emitting outbox events, so
 * this is a purely additive opt-out. `false` (or `{ record: false }`) suppresses
 * the default outbox recording for the entity — used to keep PII-bearing content
 * (e.g. form submissions) out of the delivery path. A configured `emit`
 * additionally produces a curated, metadata-only event (see {@link resolveEmit}).
 */
export function resolveWebhookRecording(
  webhooks: WebhooksOption
): ResolvedWebhookRecording {
  // Only an explicit boolean `false`, or an object whose `record` is exactly
  // `false`, opts out. Every other value falls back to recording — the safe
  // default. This tolerates untyped JS configs: a malformed `null` never throws
  // (as `null.record` would), and a non-boolean `record` (e.g. the string
  // "false") is ignored rather than escaping the boolean return as a truthy
  // value. The result is always a real boolean.
  if (webhooks === false) return { record: false };
  if (typeof webhooks === "object" && webhooks !== null) {
    const record = webhooks.record === false ? false : true;
    // A curated `emit` REPLACES the default events, so it only applies when they
    // are suppressed. With `record: true` (or omitted, which defaults to record),
    // honoring `emit` would record BOTH the full `entry.*` document and the
    // curated event — double delivery, and PII shipped via `entry.*` to any
    // endpoint subscribed to it or `*`. So `emit` requires `record: false`.
    const emit = record ? undefined : resolveEmit(webhooks.emit);
    return emit ? { record, emit } : { record };
  }
  return { record: true };
}
