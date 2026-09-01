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
 * relationship -> a set difference of targets by identity (rendering an id as a
 * human title is a separate concern, kept out so this stays pure). A password
 * field is never emitted at any depth, and any stored value that looks like a
 * bcrypt hash is masked as a defense against a password field that was deleted
 * or retyped since it was captured.
 *
 * @module domains/versions/diff/compute-diff
 */

import { dequal } from "dequal";

import type { FieldConfig } from "../../../collections/fields/types";
import { normalizeStoredValue } from "../../../shared/lib/normalize-stored-value";
import { isFieldGroupType } from "../../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";

import { maskSecret } from "./mask-secret";
import { reconcileById, type ItemMatch } from "./reconcile-list";
import { richTextNode } from "./rich-text-node";
import { PLAINTEXT, sourceNode, type SourceSide } from "./source-node";
import { diffText } from "./text-diff";
import type {
  DiffStatus,
  FieldDiff,
  FieldDisplay,
  ListItemDiff,
  NodeMeta,
  RelationTarget,
  UnknownFieldDiff,
  VersionDiff,
} from "./types";

/** The engine's output; the caller stamps `from`/`to`/`locale`. */
export type VersionDiffBody = Pick<VersionDiff, "hasChanges" | "fields">;

export interface ComputeDiffOptions {
  /** Drop every node that did not change (nested included). */
  modifiedOnly?: boolean;
}

// Framework-managed columns on a top-level document, never user content.
const SYSTEM_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "status",
]);

// The only framework key on a NESTED ROW (a component instance or repeater
// item). A plain group has no framework columns at all, so a group child named
// `id`/`status` is user content and must still surface when removed; the broad
// document set applies only at the top. `_componentType` is caught by `_`.
const ROW_SYSTEM_KEYS = new Set(["id"]);
const NO_SYSTEM_KEYS = new Set<string>();

/** Where in the tree a walk is, which decides framework-key and redaction rules. */
interface WalkContext {
  /** The top-level document object (framework columns live here). */
  top: boolean;
  /** A component-instance or repeater ROW object (its `id` is framework). */
  inRow: boolean;
  /**
   * True once the walk has descended through a component. Redaction never runs
   * there (the field-function registry holds no component-child functions), so
   * the engine omits any field declaring a read rule rather than risk exposing
   * a value the caller may not read. Best-effort: a component persisted through
   * the registry has its access callbacks stripped, so this cannot catch every
   * rule; passwords are additionally masked by value.
   */
  inComponent: boolean;
}

// Field types whose value is a single string diffed word by word. slug/url/phone
// are not core field types but are string-valued (plugin field types, and the
// admin value-display kit groups them with text), so word-diffing them is
// correct; a type no field actually has simply never matches. richText is not
// here because it is not a single string: it is compared block by block by
// `rich-text-node`, which keeps its structure and its non-text properties.
const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "email",
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
/**
 * The language a code field declares, which the renderer needs to pick a
 * grammar.
 *
 * Read from `admin.language`, which is where `CodeFieldAdminOptions` declares
 * it and where the field's own editor reads it. A top-level `language` is not
 * part of the config's shape, so looking there found nothing on every correctly
 * configured field and silently rendered all of them as plain text.
 */
function codeLanguageOf(field: FieldConfig): string | undefined {
  const admin = (field as { admin?: { language?: unknown } }).admin;
  return typeof admin?.language === "string" ? admin.language : undefined;
}
function isHasMany(field: FieldConfig): boolean {
  return (field as { hasMany?: boolean }).hasMany === true;
}

/**
 * The display-relevant configuration a value node needs to render faithfully.
 * Copies only plain data the read UI reads (cardinality, relation targets,
 * option labels, date picker), never functions such as access rules, and
 * reconstructs nested objects so nothing extra rides along.
 */
function pickFieldDisplay(field: FieldConfig): FieldDisplay | undefined {
  const f = field as {
    hasMany?: boolean;
    relationTo?: string | string[];
    targetLabelField?: unknown;
    options?: unknown;
    admin?: { date?: { pickerAppearance?: string } };
  };
  const display: FieldDisplay = {};
  if (f.hasMany === true) display.hasMany = true;

  // A relationship's target is usually `relationTo`; dynamic and many-to-many
  // definitions instead nest it (and the display column) under `options`. Fall
  // back to those so the diff's set/value node still names a collection to
  // resolve against and can honor the configured label field.
  const relOptions =
    f.options && typeof f.options === "object" && !Array.isArray(f.options)
      ? (f.options as { target?: unknown; targetLabelField?: unknown })
      : undefined;
  const relationTo =
    f.relationTo ??
    (typeof relOptions?.target === "string" ? relOptions.target : undefined);
  if (relationTo !== undefined) display.relationTo = relationTo;

  const labelField = f.targetLabelField ?? relOptions?.targetLabelField;
  if (typeof labelField === "string") display.labelField = labelField;

  // Select/radio option labels live in an array-shaped `options`.
  if (Array.isArray(f.options)) {
    display.options = (f.options as { label?: string; value?: unknown }[]).map(
      o => ({ label: o?.label, value: o?.value })
    );
  }
  const pickerAppearance = f.admin?.date?.pickerAppearance;
  if (typeof pickerAppearance === "string") {
    display.admin = { date: { pickerAppearance } };
  }
  return Object.keys(display).length > 0 ? display : undefined;
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
  // Asked rather than read: the stored spelling of this key changes with the storage migration,
  // and a document written under the other one would otherwise diff as untyped.
  return readFieldGroupType(item);
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

/** Whether a field declares a read-access rule (a function or a serialized rule). */
function hasReadAccessRule(field: FieldConfig): boolean {
  const read = (field as { access?: { read?: unknown } }).access?.read;
  return read !== undefined && read !== null;
}

// ---- relationship targets ---------------------------------------------------

/** One relationship target as `{ id, relationTo? }`, or null if it has no id. */
function toTarget(value: unknown): RelationTarget | null {
  if (typeof value === "string") return value === "" ? null : { id: value };
  if (typeof value === "number") return { id: String(value) };
  if (value !== null && typeof value === "object") {
    const rel = value as {
      value?: unknown;
      id?: unknown;
      relationTo?: unknown;
    };
    const id = asText(rel.value ?? rel.id);
    if (id === "") return null;
    return typeof rel.relationTo === "string"
      ? { id, relationTo: rel.relationTo }
      : { id };
  }
  return null;
}
function toTargets(value: unknown): RelationTarget[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .map(toTarget)
    .filter((t): t is RelationTarget => t !== null);
}
/** Identity of a target: `relationTo` matters only when the relation is polymorphic. */
function targetKey(target: RelationTarget): string {
  return target.relationTo ? `${target.relationTo}:${target.id}` : target.id;
}

// ---- classification ---------------------------------------------------------

function isComponentField(field: FieldConfig): boolean {
  return isFieldGroupType(field.type);
}
/** Cardinality is decided by `repeatable`; a non-repeatable field holds one value. */
function isComponentList(field: FieldConfig): boolean {
  return isComponentField(field) && isRepeatable(field);
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

/** Child fields of a non-repeatable component value, resolved by its type. */
function singleComponentChildFields(
  field: FieldConfig,
  before: unknown,
  after: unknown
): FieldConfig[] | undefined {
  // Single-mode component: one fixed schema. `undefined` when it is not enriched
  // (the component type is gone) — distinct from an enriched but empty schema.
  if (!Array.isArray(componentSlugs(field)))
    return enrichedComponentFields(field);
  // Non-repeatable dynamic zone: the editor picked one type; resolve its schema
  // from the stored discriminator (the after value, falling back to before). A
  // type absent from the schema map is unresolved (`undefined`); a resolved type
  // keeps its fields, which may legitimately be empty.
  const type =
    componentTypeOf(asObject(after)) ?? componentTypeOf(asObject(before));
  if (type === undefined) return undefined;
  const schema = enrichedComponentSchemas(field)?.[type];
  return schema ? (schema.fields ?? []) : undefined;
}

/**
 * The child fields a NAMELESS presentational container contributes to its
 * parent level. Only groups and single-mode components nest a fixed inline
 * schema; anything else nameless has nothing to flatten.
 */
function presentationalChildren(field: FieldConfig): FieldConfig[] | undefined {
  if (field.type === "group") return inlineFields(field);
  if (
    isComponentField(field) &&
    !isComponentList(field) &&
    !Array.isArray(componentSlugs(field))
  ) {
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
  const b = asText(maskSecret(before));
  const a = asText(maskSecret(after));
  // Status is derived from the RAW text so two different masked secrets (a
  // password field since retyped as text) are still reported as changed; the
  // segments use the masked text for display.
  const changed = asText(before) !== asText(after);
  const status = statusFromPresence(
    before === "" ? null : before,
    after === "" ? null : after,
    changed
  );
  return {
    ...meta,
    kind: "text",
    status,
    segments: b === a ? [{ op: 0, text: b }] : diffText(b, a),
  };
}

function valueNode(
  meta: NodeMeta,
  before: unknown,
  after: unknown,
  display?: FieldDisplay,
  status?: DiffStatus
): FieldDiff {
  return {
    ...meta,
    kind: "value",
    status: status ?? statusFromPresence(before, after, !dequal(before, after)),
    before: maskSecret(before),
    after: maskSecret(after),
    ...(display ? { display } : {}),
  };
}

/**
 * One side of a source comparison, with its presence decided from the RAW
 * stored value.
 *
 * A json field can hold the primitive `null` as a real value, and normalization
 * collapses that to the same `null` an absent key produces. Raw key presence is
 * the only thing that still separates them, so it is read here — the last place
 * holding it — rather than inferred further down, where an added field opened
 * with a fabricated `null` line against the whole of the other side. Every
 * other type stores a string, for which the normalized empty case IS absence.
 */
function sourceSide(
  field: FieldConfig,
  raw: unknown,
  normalized: unknown
): SourceSide {
  const absent = field.type === "json" ? raw === undefined : normalized == null;
  return absent ? { present: false } : { present: true, value: normalized };
}

function setNode(
  meta: NodeMeta,
  before: unknown,
  after: unknown,
  display?: FieldDisplay
): FieldDiff {
  const beforeTargets = toTargets(before);
  const afterTargets = toTargets(after);
  const beforeKeys = new Set(beforeTargets.map(targetKey));
  const afterKeys = new Set(afterTargets.map(targetKey));
  // Dedupe by identity so a duplicated stored id yields one set entry.
  const added = dedupeTargets(
    afterTargets.filter(t => !beforeKeys.has(targetKey(t)))
  );
  const removed = dedupeTargets(
    beforeTargets.filter(t => !afterKeys.has(targetKey(t)))
  );
  let status: DiffStatus = "unchanged";
  if (added.length > 0 || removed.length > 0) {
    status =
      beforeKeys.size === 0
        ? "added"
        : afterKeys.size === 0
          ? "removed"
          : "changed";
  }
  return {
    ...meta,
    kind: "set",
    status,
    added,
    removed,
    ...(display ? { display } : {}),
  };
}
function dedupeTargets(targets: RelationTarget[]): RelationTarget[] {
  const seen = new Set<string>();
  const out: RelationTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function groupNode(
  meta: NodeMeta,
  childFields: FieldConfig[] | undefined,
  before: unknown,
  after: unknown,
  ctx: WalkContext
): FieldDiff {
  // An UNRESOLVED schema (its component type is gone) may hold a since-removed
  // child whose access rule can no longer be found, so the whole value is
  // withheld like a dropped field rather than dumped opaquely. A RESOLVED but
  // empty schema (a group or component validly scaffolded with no fields) is a
  // real empty container: it is diffed normally below, so its unknown-key pass
  // still withholds any stray stored value while a genuinely empty one shows
  // nothing rather than a false "schema unavailable" warning.
  if (childFields === undefined) return unknownNode(meta.name, before, after);
  const fields = collectNodes(childFields, before, after, ctx);
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

/** The declared child schema for one dynamic-zone component type. */
function zoneFieldsForType(
  field: FieldConfig,
  type: string | undefined
): FieldConfig[] {
  if (type === undefined) return [];
  return enrichedComponentSchemas(field)?.[type]?.fields ?? [];
}

/**
 * Field diffs for a component whose type changed between versions. A genuine
 * type change shows the OLD type's fields removed and the NEW type's fields
 * added, each read with its own schema — so a field name reused with a
 * different type across the two components is never mis-diffed, and a protected
 * field on either side is still recognised. A discriminator that merely
 * appeared or disappeared keeps the one known schema, since the underlying
 * fields are unchanged (the caller marks the node changed regardless).
 */
function componentSwapFields(
  field: FieldConfig,
  beforeType: string | undefined,
  afterType: string | undefined,
  beforeObj: Record<string, unknown>,
  afterObj: Record<string, unknown>,
  ctx: WalkContext
): FieldDiff[] {
  if (beforeType !== undefined && afterType !== undefined) {
    return [
      ...collectNodes(zoneFieldsForType(field, beforeType), beforeObj, {}, ctx),
      ...collectNodes(zoneFieldsForType(field, afterType), {}, afterObj, ctx),
    ];
  }
  const type = afterType ?? beforeType;
  return collectNodes(zoneFieldsForType(field, type), beforeObj, afterObj, ctx);
}

function itemDiff(
  match: ItemMatch,
  field: FieldConfig,
  ctx: WalkContext
): ListItemDiff {
  const beforeType =
    match.presence === "added" ? undefined : componentTypeOf(match.beforeItem);
  const afterType =
    match.presence === "removed" ? undefined : componentTypeOf(match.afterItem);
  const componentType = afterType ?? beforeType;
  // A stable id whose component type changed is a real change even if the two
  // schemas share equal-valued field names; a discriminator appearing on a
  // previously-untagged (older or imported) item counts too. Diff against BOTH
  // schemas so a protected field from either side is still recognised.
  const typeChanged = match.presence === "both" && beforeType !== afterType;
  // Resolved child schema, or [] when the item's component type is gone from the
  // current schema. `collectNodes` still runs in that case: its unknown-key pass
  // surfaces the item's stored values as opaque nodes rather than dropping them.
  const childFields = itemChildFields(field, componentType);

  if (match.presence === "added") {
    return {
      id: match.id,
      componentType,
      status: "added",
      toIndex: match.toIndex,
      fields: collectNodes(childFields, {}, match.afterItem, ctx),
    };
  }
  if (match.presence === "removed") {
    return {
      id: match.id,
      componentType,
      status: "removed",
      fromIndex: match.fromIndex,
      fields: collectNodes(childFields, match.beforeItem, {}, ctx),
    };
  }
  const fields = typeChanged
    ? componentSwapFields(
        field,
        beforeType,
        afterType,
        match.beforeItem,
        match.afterItem,
        ctx
      )
    : collectNodes(childFields, match.beforeItem, match.afterItem, ctx);
  const contentChanged =
    typeChanged || fields.some(n => n.status !== "unchanged");
  const hasMoved = match.fromIndex !== match.toIndex;
  return {
    id: match.id,
    componentType,
    // Carry the type transition so a same-id row that swapped component type is
    // legible even when neither component has field values to diff.
    ...(typeChanged
      ? { componentTypeBefore: beforeType, componentTypeAfter: afterType }
      : {}),
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
  after: unknown,
  ctx: WalkContext
): FieldDiff {
  const beforeArr = asArray(before);
  const afterArr = asArray(after);
  const { items: matches } = reconcileById(beforeArr, afterArr);
  // Every list item is a row (its `id` is framework metadata). A repeater's
  // rows keep the current component context; a component list descends into one.
  const itemCtx: WalkContext =
    field.type === "repeater"
      ? { top: false, inRow: true, inComponent: ctx.inComponent }
      : { top: false, inRow: true, inComponent: true };
  const items = matches.map(m => itemDiff(m, field, itemCtx));
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
  // Presence still classifies the change, but the value is never emitted: a
  // field gone from the schema has no findable access rule, so its history
  // cannot be proven readable and must not leave the server.
  return {
    kind: "unknown",
    name: key,
    status: statusFromPresence(before, after, !dequal(before, after)),
  };
}

// ---- field dispatch ---------------------------------------------------------

/**
 * A dynamic zone whose stored component TYPE differs between the versions — a
 * discriminator that changed, appeared, or disappeared.
 *
 * That is a change even when the shared field values match, so it is reported
 * field-by-field against each side's own schema rather than as a raw object
 * dump. Null when the field is not a dynamic zone, or when both sides hold the
 * same type and the ordinary group comparison applies.
 */
function componentSwapNode(
  meta: NodeMeta,
  field: FieldConfig,
  before: unknown,
  after: unknown,
  ctx: WalkContext
): FieldDiff | null {
  if (!Array.isArray(componentSlugs(field))) return null;
  const beforeType = componentTypeOf(asObject(before));
  const afterType = componentTypeOf(asObject(after));
  if (beforeType === afterType) return null;
  return {
    ...meta,
    kind: "group",
    status: statusFromPresence(before, after, true),
    // Carry the type transition so a swap still shows what changed even when
    // neither component instance has field values to diff.
    ...(beforeType !== undefined ? { componentTypeBefore: beforeType } : {}),
    ...(afterType !== undefined ? { componentTypeAfter: afterType } : {}),
    fields: componentSwapFields(
      field,
      beforeType,
      afterType,
      asObject(before),
      asObject(after),
      ctx
    ),
  };
}

/** A group or component field, which nests rather than holding a value. */
function nestedNode(
  meta: NodeMeta,
  field: FieldConfig,
  before: unknown,
  after: unknown,
  ctx: WalkContext
): FieldDiff {
  // A named group's value is a nested object (no longer the top level) but has
  // no framework columns of its own, and it is not a component subtree.
  if (field.type === "group") {
    return groupNode(meta, inlineFields(field) ?? [], before, after, {
      top: false,
      inRow: false,
      inComponent: ctx.inComponent,
    });
  }
  // A component instance is a row (its `id` is framework) inside a component.
  const componentCtx: WalkContext = {
    top: false,
    inRow: true,
    inComponent: true,
  };
  return (
    componentSwapNode(meta, field, before, after, componentCtx) ??
    groupNode(
      meta,
      singleComponentChildFields(field, before, after),
      before,
      after,
      componentCtx
    )
  );
}

/**
 * A json or code field, compared as LINES.
 *
 * `code` used to be word-diffed as one string, which rendered it as a
 * proportional, word-wrapped paragraph — less readable in the comparison than
 * in its own read-only display.
 */
function sourceFieldNode(
  meta: NodeMeta,
  field: FieldConfig,
  rawBefore: unknown,
  rawAfter: unknown,
  before: unknown,
  after: unknown
): FieldDiff {
  // A code field declares the language it is written in, and the renderer needs
  // it to pick a grammar. Without a declared one the field type's own
  // documented default applies; emitting the literal "code" would name a
  // language no highlighter knows.
  const language =
    field.type === "json" ? "json" : (codeLanguageOf(field) ?? PLAINTEXT);
  return sourceNode(
    meta,
    sourceSide(field, rawBefore, before),
    sourceSide(field, rawAfter, after),
    language
  );
}

/**
 * Whether a field holds ONE string, so its value can be word-diffed.
 *
 * A `hasMany` text field stores an array rather than a string, which has no
 * word-level comparison; it falls through to a value comparison instead.
 */
function isWordDiffable(field: FieldConfig): boolean {
  return TEXT_TYPES.has(field.type) && !isHasMany(field);
}

/** Whether a field's value is read as LINES rather than as prose or a value. */
function isSourceField(field: FieldConfig): boolean {
  return field.type === "json" || field.type === "code";
}

function diffField(
  field: FieldConfig,
  name: string,
  rawBefore: unknown,
  rawAfter: unknown,
  ctx: WalkContext
): FieldDiff {
  const meta: NodeMeta = { name, label: field.label ?? name, type: field.type };
  const before = normalizeStoredValue(field, rawBefore);
  const after = normalizeStoredValue(field, rawAfter);

  if (isListField(field)) return listNode(meta, field, before, after, ctx);
  if (isGroupField(field)) return nestedNode(meta, field, before, after, ctx);
  if (isSetField(field, before, after)) {
    return setNode(meta, before, after, pickFieldDisplay(field));
  }
  // Rich text is compared structurally rather than as one value. Comparing two
  // editor documents by equality reports only THAT they differ, which is the
  // one thing the reader already knows.
  if (field.type === "richText") return richTextNode(meta, before, after);
  if (isWordDiffable(field)) return textNode(meta, before, after);
  if (isSourceField(field)) {
    return sourceFieldNode(meta, field, rawBefore, rawAfter, before, after);
  }
  return valueNode(meta, before, after, pickFieldDisplay(field));
}

/**
 * Diff a list of field definitions against a before/after object. A nameless
 * presentational container contributes its children to this same level (its
 * values live flat on the parent), matching how the read UI flattens them. A
 * password is skipped at every depth; a field whose key is absent from both
 * snapshots is skipped too, so a field redaction removed (its key is deleted)
 * never reappears as an empty node. Keys present in a snapshot but absent from
 * the schema surface as unknown nodes at THIS level, so a nested field deleted
 * since capture still affects the result instead of vanishing.
 */
function collectNodes(
  fields: FieldConfig[],
  before: unknown,
  after: unknown,
  ctx: WalkContext
): FieldDiff[] {
  const beforeObj = asObject(before);
  const afterObj = asObject(after);
  const nodes: FieldDiff[] = [];
  for (const field of fields) {
    const name = field.name;
    if (name === undefined || name === "") {
      const inner = presentationalChildren(field);
      if (inner) {
        // A nameless container's children live flat on THIS object, so the
        // level (top-ness, row-ness) is unchanged; only component-ness may.
        const innerCtx: WalkContext = isComponentField(field)
          ? { top: ctx.top, inRow: ctx.inRow, inComponent: true }
          : { top: ctx.top, inRow: ctx.inRow, inComponent: ctx.inComponent };
        nodes.push(...collectNodes(inner, beforeObj, afterObj, innerCtx));
      }
      continue;
    }
    if (field.type === "password") continue;
    // Redaction never ran inside a component, so a field declaring a read rule
    // there is omitted rather than risk exposing a value the caller may not read.
    if (ctx.inComponent && hasReadAccessRule(field)) continue;
    if (!(name in beforeObj) && !(name in afterObj)) continue;
    nodes.push(diffField(field, name, beforeObj[name], afterObj[name], ctx));
  }

  // Framework keys depend on the object: the document has the full set, a
  // component/repeater row has only `id`, and a plain group has none (a group
  // child named `id`/`status` is user content).
  const systemKeys = ctx.top
    ? SYSTEM_KEYS
    : ctx.inRow
      ? ROW_SYSTEM_KEYS
      : NO_SYSTEM_KEYS;
  const consumed = topLevelNames(fields);
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  for (const key of keys) {
    if (consumed.has(key) || systemKeys.has(key) || key.startsWith("_")) {
      continue;
    }
    nodes.push(unknownNode(key, beforeObj[key], afterObj[key]));
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
  const nodes = collectNodes(fields, before, after, {
    top: true,
    inRow: false,
    inComponent: false,
  });
  const hasChanges = nodes.some(n => n.status !== "unchanged");
  if (!opts.modifiedOnly) return { hasChanges, fields: nodes };

  const fieldsOut = nodes.filter(n => n.status !== "unchanged").map(pruneNode);
  return { hasChanges, fields: fieldsOut };
}
