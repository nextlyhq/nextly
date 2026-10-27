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
import {
  SYSTEM_COLUMNS,
  type SystemColumnEntity,
} from "../../../lib/system-columns";
import { normalizeStoredValue } from "../../../shared/lib/normalize-stored-value";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import { documentSystemKeys } from "../snapshot-system-keys";

import { maskSecret } from "./mask-secret";
import { reconcileById, type ItemMatch } from "./reconcile-list";
import { richTextNode } from "./rich-text-node";
import { PLAINTEXT, sourceNode, type SourceSide } from "./source-node";
import { diffText } from "./text-diff";
import type {
  DiffPathSegment,
  DiffStatus,
  FieldDiff,
  FieldDisplay,
  HiddenFieldDiff,
  ListItemDiff,
  NodeMeta,
  RelationTarget,
  UnknownFieldDiff,
  VersionDiff,
} from "./types";

/** The engine's output; the caller stamps `from`/`to`/`locale`. */
export type VersionDiffBody = Pick<
  VersionDiff,
  "hasChanges" | "fields" | "incomplete"
>;

export interface ComputeDiffOptions {
  /** Drop every node that did not change (nested included). */
  modifiedOnly?: boolean;
  /**
   * Fields the caller's redaction removed from either snapshot: a top-level
   * name, or a dotted path below it (`banner.secret`). Each is reported in its
   * place as a hidden node rather than left out, so the reader learns it
   * exists without learning anything about its values. Applies to both
   * versions; a path that names a list row by index belongs in one version's
   * own set below, since the two versions may hold their rows in different
   * places.
   *
   * @experimental
   */
  withheld?: ReadonlySet<string>;
  /**
   * What the redaction removed from the earlier version (`before`), by that
   * version's own paths: a list row is named by its index in it
   * (`items.1.secret`).
   *
   * @experimental
   */
  withheldFrom?: ReadonlySet<string>;
  /**
   * What the redaction removed from the later version (`after`), by that
   * version's own paths, as `withheldFrom` is for the earlier one.
   *
   * @experimental
   */
  withheldTo?: ReadonlySet<string>;
  /**
   * Whether the caller's redaction applied each component's own read rules
   * inside the snapshots. Without it, a component field that declares a read
   * rule is left out, since nothing has judged it for this reader.
   *
   * @experimental
   */
  componentRulesApplied?: boolean;
  /**
   * The kind of document compared. A framework column belongs to some kinds
   * only (a Single has no owner column), and a key that is not one of this
   * kind's columns is a removed field. Defaults to `collection`.
   *
   * @experimental
   */
  entity?: SystemColumnEntity;
}

// The only framework key on a NESTED ROW (a component instance or repeater
// item). A plain group has no framework columns at all, so a group child named
// `id`/`status` is user content and must still surface when removed; the broad
// document set applies only at the top. `_componentType` is caught by `_`.
const ROW_SYSTEM_KEYS = new Set(["id"]);
const NO_SYSTEM_KEYS = new Set<string>();

// Every column the framework keeps on a document of each kind, under both
// spellings. A key among them that the schema does not declare is a system
// field (when it was first published, say), not a field the content type has
// lost.
function systemColumnKeys(entity: SystemColumnEntity): ReadonlySet<string> {
  return new Set(
    SYSTEM_COLUMNS.filter(column => column.appliesTo.includes(entity)).flatMap(
      column => [column.name, column.camelName]
    )
  );
}
const SYSTEM_COLUMN_KEYS: Readonly<
  Record<SystemColumnEntity, ReadonlySet<string>>
> = {
  collection: systemColumnKeys("collection"),
  single: systemColumnKeys("single"),
};
const NOTHING_WITHHELD: ReadonlySet<string> = new Set();

/**
 * What the redaction removed from one version, and where the walk is in it:
 * the names of the containers above this level, with a list row named by its
 * index in this version. `at` is `null` inside a row this version does not
 * hold, where it withheld nothing.
 */
interface WithheldSide {
  paths: ReadonlySet<string>;
  at: readonly string[] | null;
}

/** Where in the tree a walk is, which decides framework-key and redaction rules. */
interface WalkContext {
  /** The top-level document object (framework columns live here). */
  top: boolean;
  /** The framework columns this kind of document carries. */
  systemColumns: ReadonlySet<string>;
  /** Top-level keys this kind of document never treats as content. */
  documentKeys: ReadonlySet<string>;
  /** The containers this level sits inside, outermost first. */
  path: DiffPathSegment[];
  /**
   * What the caller's redaction removed from each version: top-level names,
   * and dotted paths for nested levels. Kept apart, because a list row sits at
   * its own index in each version, so one path can name different rows.
   */
  withheld: { from: WithheldSide; to: WithheldSide };
  /** Whether component read rules were applied before the walk. */
  componentRulesApplied: boolean;
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
  // Through the shared extractor: a migrated definition carries its zone
  // whitelist under `fieldGroups`, and reading only `components` would treat
  // that zone as a single-schema field and skip its nested diff entirely.
  return extractFieldGroupReferences(field).many;
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
/** The label a field declares, trimmed; null for none or a blank one. */
function declaredLabelOf(field: FieldConfig): string | null {
  const label = (field as { label?: unknown }).label;
  return typeof label === "string" && label.trim() !== "" ? label.trim() : null;
}

/**
 * The context one level down, inside `container`. A container contributes a
 * heading when it has a name or a label; one with neither shows none on the
 * form, so it adds none here.
 */
function inside(
  container: FieldConfig,
  ctx: WalkContext,
  level: Pick<WalkContext, "top" | "inRow" | "inComponent">
): WalkContext {
  const name =
    container.name !== undefined && container.name !== ""
      ? container.name
      : null;
  const declaredLabel = declaredLabelOf(container);
  const segment: DiffPathSegment[] =
    name === null && declaredLabel === null
      ? []
      : [{ name, declaredLabel, type: container.type }];
  return {
    ...level,
    systemColumns: ctx.systemColumns,
    documentKeys: ctx.documentKeys,
    path: [...ctx.path, ...segment],
    // Every level: redaction names a nested field by its dotted path, which a
    // named container extends in both versions alike.
    withheld:
      name === null
        ? ctx.withheld
        : {
            from: deeperIn(ctx.withheld.from, name),
            to: deeperIn(ctx.withheld.to, name),
          },
    componentRulesApplied: ctx.componentRulesApplied,
  };
}

/** One version's place, one key further down; nowhere stays nowhere. */
function deeperIn(side: WithheldSide, key: string): WithheldSide {
  return {
    paths: side.paths,
    at: side.at === null ? null : [...side.at, key],
  };
}

/**
 * The context for one row of a list, which sits at its own index in each
 * version that holds it: redaction names a field in a row by that index. A
 * row one version does not hold places that version nowhere.
 */
function inListRow(
  ctx: WalkContext,
  fromIndex: number | undefined,
  toIndex: number | undefined
): WalkContext {
  const at = (side: WithheldSide, index: number | undefined): WithheldSide =>
    index === undefined
      ? { paths: side.paths, at: null }
      : deeperIn(side, String(index));
  return {
    ...ctx,
    withheld: {
      from: at(ctx.withheld.from, fromIndex),
      to: at(ctx.withheld.to, toIndex),
    },
  };
}

function hasReadAccessRule(field: FieldConfig): boolean {
  const read = (field as { access?: { read?: unknown } }).access?.read;
  return read !== undefined && read !== null;
}

/**
 * Whether either version's redaction withheld the field `name` at this level:
 * its key there is its name after that version's named containers and row
 * indexes.
 */
function isWithheld(ctx: WalkContext, name: string): boolean {
  return [ctx.withheld.from, ctx.withheld.to].some(
    side => side.at !== null && side.paths.has([...side.at, name].join("."))
  );
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
  return isFieldGroupFieldType(field.type);
}
/** Cardinality is decided by `repeatable`; a non-repeatable field holds one value. */
function isComponentList(field: FieldConfig): boolean {
  return isComponentField(field) && isRepeatable(field);
}
/**
 * Whether a field holds a list of rows, by its cardinality rather than by the
 * shape its value arrives in: a non-repeatable component populated from its
 * own table arrives as a one-element array and still holds one value. Shared
 * with the redaction's path naming, so a path names a row by index exactly
 * where this comparison reads rows.
 */
export function isListField(field: FieldConfig): boolean {
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
  if (childFields === undefined) {
    return unknownNode(meta.name, before, after, meta.path, "removed");
  }
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
  listCtx: WalkContext
): ListItemDiff {
  // The row's own place in each version that holds it, where redaction named
  // what it withheld from that row.
  const ctx = inListRow(
    listCtx,
    match.presence === "added" ? undefined : match.fromIndex,
    match.presence === "removed" ? undefined : match.toIndex
  );
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
  const itemCtx = inside(field, ctx, {
    top: false,
    inRow: true,
    inComponent: field.type === "repeater" ? ctx.inComponent : true,
  });
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
  after: unknown,
  path: DiffPathSegment[],
  reason: NonNullable<UnknownFieldDiff["reason"]>
): UnknownFieldDiff {
  // Presence still classifies the change, but the value is never emitted: a
  // field gone from the schema has no findable access rule, so its history
  // cannot be proven readable and must not leave the server.
  return {
    kind: "unknown",
    name: key,
    status: statusFromPresence(before, after, !dequal(before, after)),
    reason,
    path,
  };
}

/** A field redaction withheld: named in its place, with nothing of its values. */
function hiddenNode(
  field: FieldConfig,
  name: string,
  ctx: WalkContext
): HiddenFieldDiff {
  const declaredLabel = declaredLabelOf(field);
  return {
    kind: "hidden",
    reason: "no-access",
    name,
    label: declaredLabel ?? name,
    declaredLabel,
    type: field.type,
    status: "unchanged",
    path: ctx.path,
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
    return groupNode(
      meta,
      inlineFields(field) ?? [],
      before,
      after,
      inside(field, ctx, {
        top: false,
        inRow: false,
        inComponent: ctx.inComponent,
      })
    );
  }
  // A component instance is a row (its `id` is framework) inside a component.
  const componentCtx = inside(field, ctx, {
    top: false,
    inRow: true,
    inComponent: true,
  });
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
  const declaredLabel = declaredLabelOf(field);
  const meta: NodeMeta = {
    name,
    label: declaredLabel ?? name,
    declaredLabel,
    path: ctx.path,
    type: field.type,
  };
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
  return [
    ...fields.flatMap(field => fieldNodes(field, beforeObj, afterObj, ctx)),
    ...undeclaredNodes(fields, beforeObj, afterObj, ctx),
  ];
}

/** The nodes one declared field contributes at this level: none, one, or a nameless container's. */
function fieldNodes(
  field: FieldConfig,
  beforeObj: Record<string, unknown>,
  afterObj: Record<string, unknown>,
  ctx: WalkContext
): FieldDiff[] {
  const name = field.name;
  if (name === undefined || name === "") {
    const inner = presentationalChildren(field);
    if (!inner) return [];
    // A nameless container's children live flat on THIS object, so the level
    // (top-ness, row-ness) is unchanged; only component-ness may.
    const innerCtx = inside(field, ctx, {
      top: ctx.top,
      inRow: ctx.inRow,
      inComponent: isComponentField(field) ? true : ctx.inComponent,
    });
    return collectNodes(inner, beforeObj, afterObj, innerCtx);
  }
  if (field.type === "password") return [];
  // Unless the caller's redaction judged component rules, a component field
  // that declares one is left out: nothing has decided this reader may see it.
  if (
    ctx.inComponent &&
    !ctx.componentRulesApplied &&
    hasReadAccessRule(field)
  ) {
    return [];
  }
  // Withheld from either version: say so in place, and diff neither side. A
  // rule that reads the document can deny one version only, and comparing the
  // side that is left would still say the field came or went. Below the top
  // level, redaction names a field by its dotted path (`banner.secret`),
  // components included, since their own read rules run before the diff, and
  // a list row by its index in that version (`items.1.secret`).
  if (isWithheld(ctx, name)) {
    return [hiddenNode(field, name, ctx)];
  }
  if (!(name in beforeObj) && !(name in afterObj)) return [];
  return [diffField(field, name, beforeObj[name], afterObj[name], ctx)];
}

/**
 * Keys a snapshot holds at this level that no declared field consumes: system
 * fields first, then the fields the content type no longer has, so a removed
 * field never sits among the ones a reader is working with.
 */
function undeclaredNodes(
  fields: FieldConfig[],
  beforeObj: Record<string, unknown>,
  afterObj: Record<string, unknown>,
  ctx: WalkContext
): FieldDiff[] {
  const ignored = frameworkKeysAt(ctx);
  const consumed = topLevelNames(fields);
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const system: FieldDiff[] = [];
  const removed: FieldDiff[] = [];
  for (const key of keys) {
    if (consumed.has(key) || ignored.has(key) || key.startsWith("_")) continue;
    const isSystem = ctx.top && ctx.systemColumns.has(key);
    const node = unknownNode(
      key,
      beforeObj[key],
      afterObj[key],
      ctx.path,
      isSystem ? "system" : "removed"
    );
    (isSystem ? system : removed).push(node);
  }
  return [...system, ...removed];
}

/**
 * Framework keys depend on the object: the document has the full set, a
 * component/repeater row has only `id`, and a plain group has none (a group
 * child named `id`/`status` is user content).
 */
function frameworkKeysAt(ctx: WalkContext): ReadonlySet<string> {
  if (ctx.top) return ctx.documentKeys;
  return ctx.inRow ? ROW_SYSTEM_KEYS : NO_SYSTEM_KEYS;
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

/** Whether any node, at any depth, is a field redaction withheld. */
function containsHidden(nodes: readonly FieldDiff[]): boolean {
  return nodes.some(
    node =>
      node.kind === "hidden" ||
      (node.kind === "group" && containsHidden(node.fields)) ||
      (node.kind === "list" &&
        node.items.some(item => containsHidden(item.fields)))
  );
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

/** What one version withheld: its own set, with what both versions withheld. */
function withheldIn(
  opts: ComputeDiffOptions,
  own: ReadonlySet<string> | undefined
): ReadonlySet<string> {
  const both = opts.withheld ?? NOTHING_WITHHELD;
  if (own === undefined || own.size === 0) return both;
  return both.size === 0 ? own : new Set([...both, ...own]);
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
    systemColumns: SYSTEM_COLUMN_KEYS[opts.entity ?? "collection"],
    documentKeys: documentSystemKeys(opts.entity ?? "collection"),
    path: [],
    withheld: {
      from: { paths: withheldIn(opts, opts.withheldFrom), at: [] },
      to: { paths: withheldIn(opts, opts.withheldTo), at: [] },
    },
    componentRulesApplied: opts.componentRulesApplied === true,
  });
  const hasChanges = nodes.some(n => n.status !== "unchanged");
  // Read before pruning: a field withheld inside a group, a repeater row or a
  // component is a hidden node at that depth, and `modifiedOnly` drops it with
  // the other unchanged nodes, so the flag is what still tells the reader.
  const incomplete = containsHidden(nodes);
  if (!opts.modifiedOnly) return { hasChanges, incomplete, fields: nodes };

  // Changed nodes only. A hidden field's change cannot be known, so it is not
  // listed as one; `incomplete` tells the reader the comparison left it out.
  const fieldsOut = nodes.filter(n => n.status !== "unchanged").map(pruneNode);
  return { hasChanges, incomplete, fields: fieldsOut };
}
