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

import { componentTypeSegment } from "./expand-component-fields";
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

  // Dates have no enumerable keys, so the object branch below would treat any
  // two of them as equal; compare by instant instead. A date-only change must
  // still register in changedFields.
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

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
 * Recursively drop every key whose dotted PATH is in `denied`, descending into
 * nested objects and arrays (Nextly allows secret fields at any depth, e.g. a
 * password inside a group or repeater). Dates are treated as leaves. Returns a
 * fresh structure so the caller's objects are never mutated.
 *
 * Matching is by path rather than bare key so a sensitive name nested somewhere
 * cannot strip an unrelated field that happens to share it — a component with a
 * hidden `title` must not remove the document's own `title`. Array elements do
 * not add a segment, so one path covers every element of a repeater.
 */
function stripValue(
  value: unknown,
  denied: Set<string>,
  paths: readonly string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map(v => stripValue(v, denied, paths));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    // A dynamic-zone instance names the component type it is an instance of.
    // Two member types can share a field name with only one marking it
    // sensitive, so those denials are recorded under a type-tagged path and
    // only apply to instances of that type.
    const componentType = (value as { _componentType?: unknown })
      ._componentType;
    const prefixes =
      typeof componentType === "string"
        ? [
            ...paths,
            ...paths.map(p =>
              p
                ? `${p}.${componentTypeSegment(componentType)}`
                : componentTypeSegment(componentType)
            ),
          ]
        : paths;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const childPaths = prefixes.map(p => (p ? `${p}.${k}` : k));
      if (childPaths.some(candidate => denied.has(candidate))) continue;
      out[k] = stripValue(v, denied, childPaths);
    }
    return out;
  }
  return value;
}

/**
 * Return a deep copy of `doc` without the sensitive field paths. A path that
 * matches nothing is a no-op, so callers can pass a superset (e.g. every secret
 * field of the collection) safely.
 */
function stripSensitive(
  doc: Record<string, unknown>,
  sensitiveFields: readonly string[]
): Record<string, unknown> {
  if (sensitiveFields.length === 0) return { ...doc };
  return stripValue(doc, new Set(sensitiveFields), [""]) as Record<
    string,
    unknown
  >;
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
  /** Event time as a Date; normalized to an ISO-8601 string on the envelope. */
  timestamp: Date;
  site?: string;
  resource: WebhookResource;
  /**
   * Current state of the resource as the DESERIALIZED document — group/repeater
   * and other JSON container fields parsed back to objects/arrays, i.e. the
   * shape the API returns, not the raw persisted row. Recursive secret
   * stripping only reaches a nested field when it is a real object, so callers
   * must pass the parsed document (the write paths already parse it for their
   * response); a field still held as a JSON string would not be traversed.
   */
  data: Record<string, unknown>;
  /** Prior state on update/delete/status-change; null/undefined on create. Same deserialized-document requirement as `data`. */
  previous?: Record<string, unknown> | null;
  actor?: WebhookActor | null;
  /**
   * Dotted field PATHS to strip from both `data` and `previous` before
   * shipping (`secret`, `profile.apiKey`). Bare names would strip every
   * occurrence of that key at any depth, including unrelated siblings.
   */
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
    timestamp: input.timestamp.toISOString(),
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
