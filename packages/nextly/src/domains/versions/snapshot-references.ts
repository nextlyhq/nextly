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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { FieldConfig } from "../../collections/fields/types";
import { isFieldGroupType } from "../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../field-groups/storage/field-group-type-key";
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

/**
 * Child fields for one component instance. A component carries its schema in the
 * enriched `componentSchemas` (keyed by the instance's `_componentType`, for a
 * dynamic zone) or `componentFields` (a fixed component), never in `fields` —
 * the same shape the diff engine reads.
 */
function componentChildFieldsFor(
  field: FieldConfig,
  instance: unknown
): FieldConfig[] {
  const enriched = field as {
    componentFields?: FieldConfig[];
    componentSchemas?: Record<string, { fields?: FieldConfig[] }>;
  };
  // Asked rather than read: a snapshot was written under the schema of its day, which may be
  // either side of the storage migration's rename of this key.
  const type = isPlainObject(instance)
    ? readFieldGroupType(instance)
    : undefined;
  if (type && enriched.componentSchemas?.[type]?.fields) {
    return enriched.componentSchemas[type].fields ?? [];
  }
  if (Array.isArray(enriched.componentFields)) return enriched.componentFields;
  return childFieldsOf(field);
}

/** Whether a field declares a read-access rule (a function or a serialized rule). */
function hasReadAccessRule(field: FieldConfig): boolean {
  const read = (field as { access?: { read?: unknown } }).access?.read;
  return read !== undefined && read !== null;
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
 *
 * `inComponent` is carried through every recursion once a component is entered.
 * Redaction cannot evaluate the read rule of any field nested inside a component
 * (the diff engine omits them for the same reason), so while inside one, a field
 * declaring `access.read` is skipped at ANY depth — a protected relationship or
 * upload sitting under a group or repeater within a component must not be
 * hydrated into a readable label either.
 */
function walk(
  value: unknown,
  fields: FieldConfig[],
  visit: (
    field: FieldConfig,
    holder: Record<string, unknown>,
    name: string
  ) => void,
  inComponent = false
): void {
  if (!isPlainObject(value)) return;

  for (const field of fields) {
    const name = field.name;

    // Inside a component, a field the caller may not read was not stripped by
    // redaction, so it is skipped here rather than resolved to a label.
    if (inComponent && hasReadAccessRule(field)) continue;

    // A nameless presentational group stores its children on THIS object, so
    // recurse its fields against the same holder rather than skipping it.
    if (typeof name !== "string" || name.length === 0) {
      if (field.type === "group") {
        const inline = childFieldsOf(field);
        if (inline.length > 0) walk(value, inline, visit, inComponent);
      }
      continue;
    }

    const raw = parseIfJsonString(value[name]);
    if (raw === undefined || raw === null) continue;

    if (field.type === "relationship" || field.type === "upload") {
      value[name] = raw;
      visit(field, value, name);
      continue;
    }

    value[name] = raw;

    // A component's children live in its enriched schema keyed by each
    // instance's type, not in `fields`, so resolve them per instance. Everything
    // below a component is walked with `inComponent`, so the read-rule skip
    // above applies to its whole subtree.
    if (isFieldGroupType(field.type)) {
      const instances = Array.isArray(raw) ? raw : [raw];
      for (const instance of instances) {
        walk(instance, componentChildFieldsFor(field, instance), visit, true);
      }
      continue;
    }

    const children = childFieldsOf(field);
    if (children.length === 0) continue;
    if (Array.isArray(raw)) {
      for (const row of raw) walk(row, children, visit, inComponent);
    } else {
      walk(raw, children, visit, inComponent);
    }
  }
}

/** The relationship field's configured display column (`targetLabelField`), if any. */
function fieldLabelField(field: FieldConfig): string | undefined {
  const direct = (field as { targetLabelField?: unknown }).targetLabelField;
  if (typeof direct === "string") return direct;
  const nested = (field as { options?: { targetLabelField?: unknown } }).options
    ?.targetLabelField;
  return typeof nested === "string" ? nested : undefined;
}

/** The reference requests one relationship/upload value contributes. */
function requestsForValue(
  field: FieldConfig,
  value: unknown
): ReferenceRequest[] {
  const kind = refKindOf(field.type);
  if (!kind) return [];
  // An upload names its target collection the same way a relationship does; a
  // plain `upload()` declares none, and `toReferenceRequest` then defaults it to
  // the built-in `media` library. Hardcoding `media` here would ignore an
  // upload bound to a custom collection and leave it unresolved.
  const cols = fieldTargets(field);
  const labelField = fieldLabelField(field);
  const out: ReferenceRequest[] = [];
  for (const stored of storedRefsOf(value)) {
    const request = toReferenceRequest(kind, stored, cols, labelField);
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
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<void> {
  if (!isPlainObject(snapshot) || fields.length === 0) return;

  // Pass 1: collect every reference the snapshot carries.
  const requests: ReferenceRequest[] = [];
  walk(snapshot, fields, (field, holder, name) => {
    requests.push(...requestsForValue(field, holder[name]));
  });
  if (requests.length === 0) return;

  // Pass 2: resolve each distinct reference once, access-checked, in the
  // version's own locale.
  const labels = await resolveReferenceLabels(
    requests,
    user,
    authenticatedScope,
    locale
  );

  // Pass 3: rewrite each value to its display shape, preserving cardinality.
  walk(snapshot, fields, (field, holder, name) => {
    const kind = refKindOf(field.type);
    if (!kind) return;
    const cols = fieldTargets(field);
    const labelField = fieldLabelField(field);
    const current = holder[name];

    const substitute = (stored: StoredRef): unknown => {
      const request = toReferenceRequest(kind, stored, cols, labelField);
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
