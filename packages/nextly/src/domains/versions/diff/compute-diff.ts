/**
 * The schema-driven version diff engine.
 *
 * A pure function: given two already-redacted snapshots and the CURRENT field
 * definitions, it walks the fields (so every node carries a human label) and
 * produces a typed diff tree. It holds no database handle and no user context —
 * redaction and access are enforced one layer up, in the dispatcher, before the
 * snapshots reach here.
 *
 * Field types map to nodes as: text-like -> word segments; scalar/media/single
 * relationship -> before/after values; group and single component -> nested
 * fields; repeatable and dynamic-zone -> items matched by stable id; many
 * relationship -> a set difference of ids (resolving ids to titles is task 022,
 * kept out so this stays pure). A password field is never emitted at any depth.
 *
 * @module domains/versions/diff/compute-diff
 */

import { dequal } from "dequal";

import type { FieldConfig } from "../../../collections/fields/types";
import { normalizeStoredValue } from "../../../shared/lib/normalize-stored-value";

import { reconcileById, type ItemMatch } from "./reconcile-list";
import { diffText } from "./text-diff";
import type {
  DiffStatus,
  FieldDiff,
  ListItemDiff,
  UnknownFieldDiff,
  VersionDiff,
} from "./types";

/** The engine's output; the caller stamps `from`/`to`/`locale`. */
export type VersionDiffBody = Pick<VersionDiff, "hasChanges" | "fields">;

export interface ComputeDiffOptions {
  /** Drop every node that did not change (nested included). */
  modifiedOnly?: boolean;
}

/** The label triple every emitted node carries, computed once with a real name. */
interface NodeMeta {
  name: string;
  label: string;
  type: string;
}

// Persisted columns that are not user fields, so they never diff as content.
const SYSTEM_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "status",
]);

// Field types whose value is a single string diffed word by word. richText is
// deliberately excluded: there is no server-side plain-text flattener, so v1
// diffs it as a whole value (each side rendered read-only) rather than guessing.
const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "code",
  "slug",
  "url",
  "phone",
]);

// ---- small typed structural accessors (no `any`) ----------------------------

function inlineFields(field: FieldConfig): FieldConfig[] | undefined {
  return (field as { fields?: FieldConfig[] }).fields;
}
function componentSlugs(field: FieldConfig): string[] | undefined {
  return (field as { components?: string[] }).components;
}
function isRepeatable(field: FieldConfig): boolean {
  return (field as { repeatable?: boolean }).repeatable === true;
}
function isHasMany(field: FieldConfig): boolean {
  return (field as { hasMany?: boolean }).hasMany === true;
}
function enrichedComponentFields(
  field: FieldConfig
): FieldConfig[] | undefined {
  return (field as { componentFields?: FieldConfig[] }).componentFields;
}
function enrichedComponentSchemas(
  field: FieldConfig
): Record<string, { fields?: FieldConfig[] }> | undefined {
  return (
    field as {
      componentSchemas?: Record<string, { fields?: FieldConfig[] }>;
    }
  ).componentSchemas;
}
function componentTypeOf(item: Record<string, unknown>): string | undefined {
  const tag = item._componentType;
  return typeof tag === "string" ? tag : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Coerce a primitive to text; anything object-like becomes empty (never `[object Object]`). */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** A relationship/upload id, whether stored bare or as `{ relationTo, value }`. */
function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value !== null && typeof value === "object") {
    const rel = value as { value?: unknown; id?: unknown };
    return asText(rel.value ?? rel.id);
  }
  return "";
}
function toIdList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .map(idOf)
    .filter(id => id !== "");
}

// ---- classification ---------------------------------------------------------

function isComponentField(field: FieldConfig): boolean {
  return field.type === "component";
}
/** A component field is a list when it is a dynamic zone or marked repeatable. */
function isComponentList(field: FieldConfig): boolean {
  return (
    isComponentField(field) &&
    (Array.isArray(componentSlugs(field)) || isRepeatable(field))
  );
}
function isListField(field: FieldConfig): boolean {
  return field.type === "repeater" || isComponentList(field);
}
function isGroupField(field: FieldConfig): boolean {
  return (
    field.type === "group" ||
    (isComponentField(field) && !isComponentList(field))
  );
}
function isSetField(
  field: FieldConfig,
  before: unknown,
  after: unknown
): boolean {
  return (
    field.type === "relationship" &&
    (isHasMany(field) || Array.isArray(before) || Array.isArray(after))
  );
}

/**
 * The child fields a NAMELESS presentational container contributes to its
 * parent level. Only groups and single components nest fields; anything else
 * nameless has nothing to flatten.
 */
function presentationalChildren(field: FieldConfig): FieldConfig[] | undefined {
  if (field.type === "group") return inlineFields(field);
  if (isComponentField(field) && !isComponentList(field)) {
    return enrichedComponentFields(field);
  }
  return undefined;
}

function statusFromPresence(
  before: unknown,
  after: unknown,
  changed: boolean
): DiffStatus {
  const beforeEmpty = before === null || before === undefined;
  const afterEmpty = after === null || after === undefined;
  if (beforeEmpty && afterEmpty) return "unchanged";
  if (beforeEmpty) return "added";
  if (afterEmpty) return "removed";
  return changed ? "changed" : "unchanged";
}

// ---- per-kind node builders (all take a resolved meta) ----------------------

function textNode(meta: NodeMeta, before: unknown, after: unknown): FieldDiff {
  const b = asText(before);
  const a = asText(after);
  const status = statusFromPresence(
    before === "" ? null : before,
    after === "" ? null : after,
    b !== a
  );
  return {
    ...meta,
    kind: "text",
    status,
    segments: b === a ? [{ op: 0, text: b }] : diffText(b, a),
  };
}

function valueNode(meta: NodeMeta, before: unknown, after: unknown): FieldDiff {
  return {
    ...meta,
    kind: "value",
    status: statusFromPresence(before, after, !dequal(before, after)),
    before,
    after,
  };
}

function setNode(meta: NodeMeta, before: unknown, after: unknown): FieldDiff {
  const beforeIds = toIdList(before);
  const afterIds = toIdList(after);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const added = afterIds.filter(id => !beforeSet.has(id));
  const removed = beforeIds.filter(id => !afterSet.has(id));
  let status: DiffStatus = "unchanged";
  if (added.length > 0 || removed.length > 0) {
    status =
      beforeIds.length === 0
        ? "added"
        : afterIds.length === 0
          ? "removed"
          : "changed";
  }
  return { ...meta, kind: "set", status, added, removed };
}

function groupNode(
  meta: NodeMeta,
  childFields: FieldConfig[],
  before: unknown,
  after: unknown
): FieldDiff {
  // With no resolvable child schema, fall back to an opaque value comparison
  // rather than reporting a group with no fields.
  if (childFields.length === 0) return valueNode(meta, before, after);
  const fields = collectNodes(childFields, before, after);
  const changed = fields.some(n => n.status !== "unchanged");
  return {
    ...meta,
    kind: "group",
    status: statusFromPresence(before, after, changed),
    fields,
  };
}

/** Resolve the field schema for one list item (repeater rows or a zone type). */
function itemChildFields(
  field: FieldConfig,
  componentType: string | undefined
): FieldConfig[] {
  if (field.type === "repeater") return inlineFields(field) ?? [];
  // Repeatable single-type component: every item shares one schema.
  const single = enrichedComponentFields(field);
  if (single && !Array.isArray(componentSlugs(field))) return single;
  // Dynamic zone: pick the schema for this item's component type.
  if (componentType !== undefined) {
    const schema = enrichedComponentSchemas(field)?.[componentType];
    if (schema?.fields) return schema.fields;
  }
  return [];
}

function itemDiff(match: ItemMatch, field: FieldConfig): ListItemDiff {
  const source =
    match.presence === "removed" ? match.beforeItem : match.afterItem;
  const componentType = componentTypeOf(source);
  const childFields = itemChildFields(field, componentType);

  if (match.presence === "added") {
    return {
      id: match.id,
      componentType,
      status: "added",
      toIndex: match.toIndex,
      fields:
        childFields.length > 0
          ? collectNodes(childFields, {}, match.afterItem)
          : [],
    };
  }
  if (match.presence === "removed") {
    return {
      id: match.id,
      componentType,
      status: "removed",
      fromIndex: match.fromIndex,
      fields:
        childFields.length > 0
          ? collectNodes(childFields, match.beforeItem, {})
          : [],
    };
  }
  const fields =
    childFields.length > 0
      ? collectNodes(childFields, match.beforeItem, match.afterItem)
      : [];
  const contentChanged =
    childFields.length > 0
      ? fields.some(n => n.status !== "unchanged")
      : !dequal(match.beforeItem, match.afterItem);
  const hasMoved = match.fromIndex !== match.toIndex;
  return {
    id: match.id,
    componentType,
    status: contentChanged ? "changed" : "unchanged",
    hasMoved: hasMoved ? true : undefined,
    fromIndex: match.fromIndex,
    toIndex: match.toIndex,
    fields,
  };
}

function listNode(
  meta: NodeMeta,
  field: FieldConfig,
  before: unknown,
  after: unknown
): FieldDiff {
  const beforeArr = asArray(before);
  const afterArr = asArray(after);
  const { items: matches } = reconcileById(beforeArr, afterArr);
  const items = matches.map(m => itemDiff(m, field));
  const changed = items.some(i => i.status !== "unchanged" || i.hasMoved);
  let status: DiffStatus = "unchanged";
  if (beforeArr.length === 0 && afterArr.length > 0) status = "added";
  else if (afterArr.length === 0 && beforeArr.length > 0) status = "removed";
  else if (changed) status = "changed";
  return { ...meta, kind: "list", status, items };
}

function unknownNode(
  key: string,
  before: unknown,
  after: unknown
): UnknownFieldDiff {
  return {
    kind: "unknown",
    name: key,
    status: statusFromPresence(before, after, !dequal(before, after)),
    before,
    after,
  };
}

// ---- field dispatch ---------------------------------------------------------

function diffField(
  field: FieldConfig,
  name: string,
  rawBefore: unknown,
  rawAfter: unknown
): FieldDiff {
  const meta: NodeMeta = { name, label: field.label ?? name, type: field.type };
  const before = normalizeStoredValue(field, rawBefore);
  const after = normalizeStoredValue(field, rawAfter);

  if (isListField(field)) return listNode(meta, field, before, after);
  if (isGroupField(field)) {
    const childFields =
      field.type === "group"
        ? (inlineFields(field) ?? [])
        : (enrichedComponentFields(field) ?? []);
    return groupNode(meta, childFields, before, after);
  }
  if (isSetField(field, before, after)) return setNode(meta, before, after);
  if (TEXT_TYPES.has(field.type)) return textNode(meta, before, after);
  return valueNode(meta, before, after);
}

/**
 * Diff a list of field definitions against a before/after object. A nameless
 * presentational container contributes its children to this same level (its
 * values live flat on the parent), matching how the read UI flattens them. A
 * password is skipped at every depth.
 */
function collectNodes(
  fields: FieldConfig[],
  before: unknown,
  after: unknown
): FieldDiff[] {
  const beforeObj = asObject(before);
  const afterObj = asObject(after);
  const nodes: FieldDiff[] = [];
  for (const field of fields) {
    const name = field.name;
    if (name === undefined || name === "") {
      const inner = presentationalChildren(field);
      if (inner) nodes.push(...collectNodes(inner, beforeObj, afterObj));
      continue;
    }
    if (field.type === "password") continue;
    nodes.push(diffField(field, name, beforeObj[name], afterObj[name]));
  }
  return nodes;
}

/** Every name consumed at the top level, following nameless containers down. */
function topLevelNames(fields: FieldConfig[]): Set<string> {
  const names = new Set<string>();
  for (const field of fields) {
    if (field.name !== undefined && field.name !== "") {
      names.add(field.name);
      continue;
    }
    const inner = presentationalChildren(field);
    if (inner) for (const name of topLevelNames(inner)) names.add(name);
  }
  return names;
}

// ---- pruning for modifiedOnly ----------------------------------------------

function pruneNode(node: FieldDiff): FieldDiff {
  if (node.kind === "group") {
    return {
      ...node,
      fields: node.fields.filter(n => n.status !== "unchanged").map(pruneNode),
    };
  }
  if (node.kind === "list") {
    return {
      ...node,
      items: node.items
        .filter(i => i.status !== "unchanged" || i.hasMoved)
        .map(i => ({
          ...i,
          fields: i.fields.filter(n => n.status !== "unchanged").map(pruneNode),
        })),
    };
  }
  return node;
}

/**
 * Compare two normalized snapshots against the current field definitions.
 * Returns the diff body; the caller stamps `from`, `to`, and `locale`.
 */
export function computeVersionDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: FieldConfig[],
  opts: ComputeDiffOptions = {}
): VersionDiffBody {
  const nodes = collectNodes(fields, before, after);

  // Keys present in a snapshot but absent from the current schema (a field
  // deleted since capture) still surface, so a diff never silently hides a
  // change. System columns and internal keys are not content.
  const consumed = topLevelNames(fields);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (consumed.has(key) || SYSTEM_KEYS.has(key) || key.startsWith("_"))
      continue;
    nodes.push(unknownNode(key, before[key], after[key]));
  }

  const hasChanges = nodes.some(n => n.status !== "unchanged");
  if (!opts.modifiedOnly) return { hasChanges, fields: nodes };

  const fieldsOut = nodes.filter(n => n.status !== "unchanged").map(pruneNode);
  return { hasChanges, fields: fieldsOut };
}
