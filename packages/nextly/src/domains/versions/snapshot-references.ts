/**
 * A stored snapshot persists relationship and upload fields as bare ids, so a
 * version preview renders identifiers unless those ids are resolved. This walks
 * the snapshot against the current schema, resolves every relationship and
 * upload reference through the access-checked resolver, and rewrites each value
 * to the read-only value kit's display shape (`{ id, label }` / `{ id, filename,
 * ... }`) in place — the same shape a live entry read returns, so the preview
 * renders it through the one kit with no reference-specific handling.
 *
 * The historical id is kept inside the resolved shape; the stored link SET is
 * never re-derived, so a many-relationship still shows the links the version
 * held rather than the document's current ones.
 *
 * @module domains/versions/snapshot-references
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { UserContext } from "../singles/types";

import {
  referenceDisplayValue,
  referenceLabelKey,
  resolveReferenceLabels,
  storedRefsOf,
  toReferenceRequest,
  type ReferenceKind,
  type ReferenceRequest,
  type StoredRef,
} from "./reference-labels";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A snapshot is captured from the persisted row, so a JSON-backed container can
 * arrive already parsed or as a string depending on the dialect. Anything that
 * does not parse is left exactly as found.
 */
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** The target collection(s) a relationship field declares. */
function fieldTargets(field: FieldConfig): string[] {
  const relationTo = (field as { relationTo?: unknown }).relationTo;
  if (typeof relationTo === "string") return [relationTo];
  if (Array.isArray(relationTo)) {
    return relationTo.filter((r): r is string => typeof r === "string");
  }
  const target = (field as { options?: { target?: unknown } }).options?.target;
  return typeof target === "string" ? [target] : [];
}

/** Child fields of a container field, if any. */
function childFieldsOf(field: FieldConfig): FieldConfig[] {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : [];
}

/** The reference kind a field type resolves to, if any. */
function refKindOf(type: string): ReferenceKind | null {
  if (type === "relationship") return "relationship";
  if (type === "upload") return "upload";
  return null;
}

/**
 * Walk a value against its field list, invoking `visit` for every relationship
 * or upload leaf and descending containers so nested references are found too.
 * The container form is normalized in place as it goes.
 */
function walk(
  value: unknown,
  fields: FieldConfig[],
  visit: (
    field: FieldConfig,
    holder: Record<string, unknown>,
    name: string
  ) => void
): void {
  if (!isPlainObject(value)) return;

  for (const field of fields) {
    const name = field.name;
    if (typeof name !== "string" || name.length === 0) continue;

    const raw = parseIfJsonString(value[name]);
    if (raw === undefined || raw === null) continue;

    if (field.type === "relationship" || field.type === "upload") {
      value[name] = raw;
      visit(field, value, name);
      continue;
    }

    const children = childFieldsOf(field);
    if (children.length === 0) continue;

    value[name] = raw;
    if (Array.isArray(raw)) {
      for (const row of raw) walk(row, children, visit);
    } else {
      walk(raw, children, visit);
    }
  }
}

/** The reference requests one relationship/upload value contributes. */
function requestsForValue(
  field: FieldConfig,
  value: unknown
): ReferenceRequest[] {
  const kind = refKindOf(field.type);
  if (!kind) return [];
  const cols = kind === "upload" ? ["media"] : fieldTargets(field);
  const out: ReferenceRequest[] = [];
  for (const stored of storedRefsOf(value)) {
    const request = toReferenceRequest(kind, stored, cols);
    if (request) out.push(request);
  }
  return out;
}

/**
 * Resolve every relationship and upload reference in a snapshot to the value
 * kit's display shape, rewriting the snapshot in place. A no-op when the schema
 * declares no fields or the snapshot carries no reference.
 */
export async function hydrateSnapshotReferences(
  snapshot: unknown,
  fields: FieldConfig[],
  user: UserContext
): Promise<void> {
  if (!isPlainObject(snapshot) || fields.length === 0) return;

  // Pass 1: collect every reference the snapshot carries.
  const requests: ReferenceRequest[] = [];
  walk(snapshot, fields, (field, holder, name) => {
    requests.push(...requestsForValue(field, holder[name]));
  });
  if (requests.length === 0) return;

  // Pass 2: resolve each distinct reference once, access-checked.
  const labels = await resolveReferenceLabels(requests, user);

  // Pass 3: rewrite each value to its display shape, preserving cardinality.
  walk(snapshot, fields, (field, holder, name) => {
    const kind = refKindOf(field.type);
    if (!kind) return;
    const cols = kind === "upload" ? ["media"] : fieldTargets(field);
    const current = holder[name];

    const substitute = (stored: StoredRef): unknown => {
      const request = toReferenceRequest(kind, stored, cols);
      const resolved = request
        ? labels.get(referenceLabelKey(request))
        : undefined;
      return referenceDisplayValue(stored, resolved);
    };

    const stored = storedRefsOf(current);
    holder[name] = Array.isArray(current)
      ? stored.map(substitute)
      : stored[0]
        ? substitute(stored[0])
        : current;
  });
}
