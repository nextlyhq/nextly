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

import { TIMESTAMP_COLUMN_NAMES } from "../../shared/lib/case-conversion";
import { deepEqual } from "../../shared/lib/deep-equal";
import { defineOwnProperty } from "../../shared/lib/own-property";
import { readFieldGroupType } from "../field-groups/storage/field-group-type-key";

import { componentTypeSegment } from "./expand-component-fields";
import type {
  RecordedEventType,
  WebhookActor,
  WebhookEvent,
  WebhookResource,
} from "./types";

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
    // Asked rather than indexed, so an instance stored under either spelling still resolves to
    // the type its denial paths are recorded under.
    const componentType = readFieldGroupType(value);
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
      // Defined, not assigned: a JSON column can hold a `__proto__` key, and
      // assigning it would drop it from the envelope rather than carry it.
      defineOwnProperty(out, k, stripValue(v, denied, childPaths));
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
export function computeChangedFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
  componentRows: readonly string[] = []
): string[] {
  if (previous === null) return Object.keys(next).sort();
  const rows = new Set(componentRows);
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (
      !deepEqual(
        withoutRowStamps(previous[k], [k], rows),
        withoutRowStamps(next[k], [k], rows)
      )
    ) {
      changed.push(k);
    }
  }
  return changed.sort();
}

/**
 * The system timestamp columns a stored row carries, by their physical names: a component
 * instance arrives with them as stored, and a write rewrites them whether or not its content
 * changed. From the one system-column list, so a user field that happens to be called
 * `updatedAt` (in a group inside a component, say) is never mistaken for one.
 */
const ROW_STAMPS: ReadonlySet<string> = new Set(
  TIMESTAMP_COLUMN_NAMES.map(([column]) => column)
);

/**
 * `value`, found at the candidate dotted `paths`, without the system timestamp
 * columns of the component rows in it: the objects sitting at a path in `rows`
 * (`componentRowPaths` of the schema). A write that rewrites a component row
 * stamps it anew, and where the database keeps milliseconds that stamp differs
 * even when no field of the row did: a field is changed when its content is,
 * not its row's stamp. Every other object keeps every key, so `updated_at`
 * inside a JSON or group value still counts as the content it is, and so do the
 * document's own top-level stamps.
 *
 * Paths are spelled as `stripValue` spells them: array elements add no
 * segment, and a dynamic-zone instance's children are also reachable under its
 * type-tagged segment, where the expanded schema puts a member's own fields.
 */
function withoutRowStamps(
  value: unknown,
  paths: readonly string[],
  rows: ReadonlySet<string>
): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => withoutRowStamps(entry, paths, rows));
  }
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  // Nothing at or below these paths is a component row: the value is compared
  // as it is, without walking it.
  if (!paths.some(path => reachesRow(path, rows))) return value;
  const isRow = paths.some(path => rows.has(path));
  const componentType = isRow ? readFieldGroupType(value) : undefined;
  const prefixes =
    typeof componentType === "string"
      ? [
          ...paths,
          ...paths.map(
            path => `${path}.${componentTypeSegment(componentType)}`
          ),
        ]
      : paths;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isRow && ROW_STAMPS.has(key)) continue;
    // Defined, not assigned: a JSON value can hold a `__proto__` key.
    defineOwnProperty(
      out,
      key,
      withoutRowStamps(
        child,
        prefixes.map(prefix => `${prefix}.${key}`),
        rows
      )
    );
  }
  return out;
}

/** Whether `path` is a component row path or lies above one. */
function reachesRow(path: string, rows: ReadonlySet<string>): boolean {
  for (const row of rows) {
    if (row === path || row.startsWith(`${path}.`)) return true;
  }
  return false;
}

/**
 * A change as an event may carry it: `data` and `previous` without the
 * sensitive field paths, and the fields that differ between them. The one
 * computation of the fields an event names as changed, so the outbox
 * envelope and the in-process collection event cannot name different ones,
 * and a stripped field is never named.
 */
export function sanitizedChange(input: {
  data: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  sensitiveFields?: readonly string[];
  /** The component row paths of the schema (`componentRowPaths`). */
  componentRows?: readonly string[];
}): {
  data: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  changedFields: string[];
} {
  const sensitiveFields = input.sensitiveFields ?? [];
  const data = stripSensitive(input.data, sensitiveFields);
  const previous =
    input.previous == null
      ? null
      : stripSensitive(input.previous, sensitiveFields);
  return {
    data,
    previous,
    changedFields: computeChangedFields(previous, data, input.componentRows),
  };
}

/** Input to {@link buildEnvelope}. All identity/time values are caller-supplied. */
export interface BuildEnvelopeInput {
  /** ULID; caller-generated so the envelope stays deterministic. */
  id: string;
  type: RecordedEventType;
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
  /**
   * Dotted paths whose values are component rows (`componentRowPaths`): their
   * own system stamps are not a change. Absent, every key counts.
   */
  componentRows?: readonly string[];
  /** Status delta for a lifecycle event; copied verbatim onto the envelope. */
  statusChange?: { from: string | null; to: string };
  /** Every language the change involved; copied onto the envelope. */
  locales?: readonly string[];
  /** Whether the change moved the shared part; copied onto the envelope. */
  shared?: boolean;
}

/**
 * Build a delivery envelope. Sensitive fields are stripped from both `data` and
 * `previous` first, so `changedFields` is computed over the sanitized documents
 * and a stripped field never leaks (not even as a name).
 */
export function buildEnvelope(input: BuildEnvelopeInput): WebhookEvent {
  const { data, previous, changedFields } = sanitizedChange(input);

  const envelope: WebhookEvent = {
    id: input.id,
    type: input.type,
    specversion: "1",
    timestamp: input.timestamp.toISOString(),
    resource: input.resource,
    data,
    previous,
    changedFields,
  };

  // Only attach optional identity fields when present, so the serialized
  // payload stays clean (no `site: undefined` / `actor: null`).
  if (input.site !== undefined) envelope.site = input.site;
  if (input.actor != null) envelope.actor = input.actor;
  // Only lifecycle events pass this; keep it off every other envelope.
  if (input.statusChange !== undefined) {
    envelope.statusChange = input.statusChange;
  }
  // The change's languages and shared part, only where the caller knows them,
  // so an envelope on a site without languages keeps its earlier shape.
  if (input.locales !== undefined) envelope.locales = [...input.locales];
  if (input.shared !== undefined) envelope.shared = input.shared;

  return envelope;
}
