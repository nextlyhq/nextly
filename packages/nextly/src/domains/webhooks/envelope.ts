/**
 * Webhook domain — envelope construction (pure).
 *
 * `buildEnvelope` assembles the delivery envelope from a resource's current and
 * prior state: it strips sensitive fields, computes the changed-field diff, and
 * normalizes the timestamp. Deterministic (id + timestamp are passed in, never
 * generated here) so it is trivially unit-testable and safe to call inside the
 * write transaction.
 *
 * @module domains/webhooks/envelope
 */

import type {
  WebhookActor,
  WebhookEvent,
  WebhookEventType,
  WebhookResource,
} from "./types";

/**
 * Structural deep-equal for JSON-serializable values (null, primitives,
 * arrays, plain objects). Used to decide whether a top-level field's value
 * actually changed. Key order is irrelevant; array order is significant.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    k => Object.hasOwn(bObj, k) && deepEqual(aObj[k], bObj[k])
  );
}

/**
 * Return a shallow copy of `doc` without the sensitive field names. A missing
 * field name is a no-op, so callers can pass a superset (e.g. every secret
 * field of the collection) safely.
 */
function stripSensitive(
  doc: Record<string, unknown>,
  sensitiveFields: readonly string[]
): Record<string, unknown> {
  if (sensitiveFields.length === 0) return { ...doc };
  const out: Record<string, unknown> = {};
  const denied = new Set(sensitiveFields);
  for (const [k, v] of Object.entries(doc)) {
    if (!denied.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Top-level keys whose value differs between `previous` and `next`. A key
 * present in only one side counts as changed. Returned sorted for stable,
 * comparable output. On create (`previous` null) every present key is
 * considered changed, so a changed-field filter still matches a create that
 * sets the field.
 */
function computeChangedFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>
): string[] {
  if (previous === null) return Object.keys(next).sort();
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (!deepEqual(previous[k], next[k])) changed.push(k);
  }
  return changed.sort();
}

/** Input to {@link buildEnvelope}. All identity/time values are caller-supplied. */
export interface BuildEnvelopeInput {
  /** ULID; caller-generated so the envelope stays deterministic. */
  id: string;
  type: WebhookEventType;
  /** Event time; a Date is normalized to ISO-8601, a string is passed through. */
  timestamp: Date | string;
  site?: string;
  resource: WebhookResource;
  /** Current state of the resource. */
  data: Record<string, unknown>;
  /** Prior state on update/delete/status-change; null/undefined on create. */
  previous?: Record<string, unknown> | null;
  actor?: WebhookActor | null;
  /** Field names to strip from both `data` and `previous` before shipping. */
  sensitiveFields?: readonly string[];
}

/**
 * Build a delivery envelope. Sensitive fields are stripped from both `data` and
 * `previous` first, so `changedFields` is computed over the sanitized documents
 * and a stripped field never leaks (not even as a name).
 */
export function buildEnvelope(input: BuildEnvelopeInput): WebhookEvent {
  const sensitiveFields = input.sensitiveFields ?? [];
  const data = stripSensitive(input.data, sensitiveFields);
  const previous =
    input.previous == null
      ? null
      : stripSensitive(input.previous, sensitiveFields);

  const envelope: WebhookEvent = {
    id: input.id,
    type: input.type,
    specversion: "1",
    timestamp:
      input.timestamp instanceof Date
        ? input.timestamp.toISOString()
        : input.timestamp,
    resource: input.resource,
    data,
    previous,
    changedFields: computeChangedFields(previous, data),
  };

  // Only attach optional identity fields when present, so the serialized
  // payload stays clean (no `site: undefined` / `actor: null`).
  if (input.site !== undefined) envelope.site = input.site;
  if (input.actor != null) envelope.actor = input.actor;

  return envelope;
}
