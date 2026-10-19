/**
 * What a transform may change on an entity, judged by who put each part of it
 * there.
 *
 * A transform hands back a whole new definition, so without a judge it could
 * do anything to an entity another plugin owns: drop the owner's column, swap
 * a third plugin's hook, or set an option the entity's own definition would
 * have been refused for. Each entity therefore carries a ledger, opened from
 * the merged config and carried from one transform to the next, recording who
 * declared each field and who contributed each access rule, hook, validator
 * and admin setting. Every transform's result is judged against it:
 *
 * - a plugin may transform another plugin's entity only when it declares that
 *   plugin in `dependsOn`, so the owner cannot be uninstalled from under it;
 * - a plugin's entity keeps its table name;
 * - a field keeps its storage, and stays, unless the plugin removing or
 *   changing it is the one that declared it. The app's own fields are the
 *   exception: no plugin can declare the app as a dependency, and a plugin
 *   reshaping the app's entities is what transforms are for;
 * - an access rule, hook, validator or admin setting stays unless the entity's
 *   owner (or the app) contributed it, the transforming plugin did, or the
 *   transforming plugin declares its contributor in `dependsOn`;
 * - the result passes the validation a direct definition of the entity would,
 *   and only a refusal the transform introduced is laid at its door.
 *
 * @module plugins/entity-transform-ownership
 */
import { isDeepStrictEqual } from "node:util";

import type { CollectionConfig } from "../collections/config/define-collection";
import { validateCollectionConfig } from "../collections/config/validate-config";
import { ALL_FIELD_TYPES } from "../collections/fields/types";
import { extractFieldGroupReferences } from "../domains/field-groups/storage/field-group-field-type";
import { isFieldLocalized } from "../domains/i18n/classify-fields";
import {
  getColumnDescriptor,
  usesJunctionTable,
  type ColumnOrigin,
  type SupportedDialect,
} from "../domains/schema/services/field-column-descriptor";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../domains/singles/services/resolve-single-table-name";
import { NextlyError } from "../errors/nextly-error";
import type { FieldGroupConfig } from "../field-groups/config/types";
import { validateFieldGroupConfig } from "../field-groups/config/validate-field-group";
import { isPlainObject } from "../shared/lib/plain-copy";
import type { SingleConfig } from "../singles/config/types";
import { validateSingleConfig } from "../singles/config/validate-single";

type EntityKind = "collection" | "single" | "component";

/**
 * Who contributed something: a plugin's name, or `undefined` for the app,
 * whose config every entity, field and rule starts in unless a plugin put it
 * there.
 */
type Contributor = string | undefined;

/** The plugin running a transform, as the ledger judges it. */
export interface TransformingPlugin {
  name: string;
  /** The plugins it declares in `dependsOn`. */
  dependsOn: ReadonlySet<string>;
  /** Where the transform is declared, for the refusal's `path`. */
  path: string;
}

/** An entity as the ledger is opened from it. */
export interface LedgerEntity {
  slug: string;
  kind: EntityKind;
  definition: Record<string, unknown>;
  /** The plugin that declared the entity; absent for the app's own. */
  owner?: string;
  /** Top-level field name → the plugin that added it with `extend`. */
  extendedBy?: ReadonlyMap<string, string>;
}

/** One access rule, hook, validator or admin setting, and where it sits. */
interface Behaviour {
  key: string;
  value: unknown;
}

interface ContributedBehaviour extends Behaviour {
  by: Contributor;
}

/** Who put each part of one entity there, as transforms have left it. */
export interface OwnershipLedger {
  owner: Contributor;
  /** Field name path (`group.child`) → who declared the field. */
  fields: ReadonlyMap<string, Contributor>;
  behaviour: readonly ContributedBehaviour[];
}

/** A named field, and the name path that finds it from the entity. */
interface PlacedField {
  path: string;
  field: Record<string, unknown>;
  /** Inside a group or repeater, whose value is stored in its parent's. */
  nested: boolean;
  /**
   * The types of the fields holding it, outermost first: whether its value
   * sits in an object or in each element of an array is theirs to decide.
   */
  within: readonly unknown[];
}

const DIALECTS: readonly SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every named field, at any depth, by name path. Name paths rather than
 * positions, so a field inserted before another leaves the other's identity
 * alone.
 */
function placedFields(
  fields: unknown,
  prefix = "",
  within: readonly unknown[] = []
): PlacedField[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    if (!isRecord(field) || typeof field.name !== "string") return [];
    const path = prefix === "" ? field.name : `${prefix}.${field.name}`;
    return [
      { path, field, nested: prefix !== "", within },
      ...placedFields(field.fields, path, [...within, field.type]),
    ];
  });
}

function fieldsByPath(definition: Record<string, unknown>) {
  return new Map(placedFields(definition.fields).map(p => [p.path, p]));
}

/** The keys of an entity or field whose values are behaviour, not storage. */
const RULE_BLOCKS = ["access", "admin"] as const;

/** Keys read on their own terms rather than searched for functions. */
const READ_APART: ReadonlySet<string> = new Set([
  ...RULE_BLOCKS,
  "hooks",
  // Each field is a node of its own, with its own key.
  "fields",
]);

/**
 * Every function in `value`, at any depth of plain objects and arrays, keyed
 * by its path: a nested setting such as `preview.url` runs as surely as a
 * top-level validator does.
 */
function functionsIn(
  value: unknown,
  key: string,
  // The containers on the path being walked: free-form settings such as
  // `custom` may loop back to an object, which the copy a transform receives
  // keeps. Only the current path, so a container two settings share is
  // recorded under each, and replacing it under one is seen.
  seen: WeakSet<object> = new WeakSet()
): Behaviour[] {
  if (typeof value === "function") return [{ key, value }];
  // Plain objects and arrays only: a class instance is a value, not settings.
  if (!Array.isArray(value) && !isPlainObject(value)) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const found = entries.flatMap(([name, item]) =>
    functionsIn(item, `${key}.${name}`, seen)
  );
  seen.delete(value);
  return found;
}

/**
 * Each access rule, hook, admin setting and function on `node`, keyed by
 * where it sits: one entry per access operation and per admin setting, one
 * per hook in each hook list, so adding a hook beside another's removes
 * nothing, and one per function anywhere else on it — a validator, a
 * function default, a preview URL — since a function is behaviour wherever
 * it sits, as a disabled plugin's transform also treats it.
 */
function behaviourOn(node: Record<string, unknown>, at: string): Behaviour[] {
  const found: Behaviour[] = [];
  for (const block of RULE_BLOCKS) {
    const rules = node[block];
    if (!isRecord(rules)) continue;
    for (const [key, value] of Object.entries(rules)) {
      found.push({ key: `${at}${block}.${key}`, value });
    }
  }
  if (isRecord(node.hooks)) {
    for (const [event, hooks] of Object.entries(node.hooks)) {
      const key = `${at}hooks.${event}`;
      const list: unknown[] = Array.isArray(hooks) ? hooks : [hooks];
      found.push(...list.map(value => ({ key, value })));
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (!READ_APART.has(key)) found.push(...functionsIn(value, `${at}${key}`));
  }
  return found;
}

/** The behaviour on an entity and on each of its fields. */
function behaviourOf(definition: Record<string, unknown>): Behaviour[] {
  return [
    ...behaviourOn(definition, ""),
    ...placedFields(definition.fields).flatMap(({ path, field }) =>
      behaviourOn(field, `fields.${path}.`)
    ),
  ];
}

/** The field a behaviour key sits on, or `undefined` for the entity's own. */
function fieldOfKey(
  key: string,
  fields: ReadonlyMap<string, Contributor>
): string | undefined {
  if (!key.startsWith("fields.")) return undefined;
  // The longest declared path the key starts with: `fields.a.b.access.read`
  // sits on `a.b` when `a.b` is a field, and on `a` otherwise.
  return [...fields.keys()]
    .filter(path => key.startsWith(`fields.${path}.`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * The ledger of an entity as the merged config declares it: every field is
 * its owner's unless a plugin added it with `extend`, a nested field is
 * whoever declared the field holding it, and every rule is whoever declared
 * the entity or field it sits on.
 */
export function openLedger(entity: LedgerEntity): OwnershipLedger {
  const owner = entity.owner;
  const fields = new Map<string, Contributor>();
  for (const { path } of placedFields(entity.definition.fields)) {
    const top = path.split(".")[0] ?? path;
    fields.set(path, entity.extendedBy?.get(top) ?? owner);
  }
  const behaviour = behaviourOf(entity.definition).map(item => {
    const field = fieldOfKey(item.key, fields);
    return { ...item, by: field === undefined ? owner : fields.get(field) };
  });
  return { owner, fields, behaviour };
}

function refusal(
  plugin: TransformingPlugin,
  code: string,
  message: string
): NextlyError {
  return NextlyError.validation({
    errors: [{ path: plugin.path, code, message }],
    logContext: { reason: "entity transform refused", plugin: plugin.name },
  });
}

/**
 * Refuse a transform of another plugin's entity that does not declare that
 * plugin in `dependsOn`. A precondition, so it runs before the transform does.
 */
export function assertMayTransform(
  slug: string,
  ledger: OwnershipLedger,
  plugin: TransformingPlugin
): void {
  const owner = ledger.owner;
  if (owner === undefined || owner === plugin.name) return;
  if (plugin.dependsOn.has(owner)) return;
  throw refusal(
    plugin,
    "TRANSFORM_DEPENDENCY_MISSING",
    `Plugin "${plugin.name}" transforms "${slug}", which plugin "${owner}" declares, but does not list "${owner}" in dependsOn. Declare it, so "${owner}" cannot be uninstalled while the change depends on it.`
  );
}

/** Which builder's column rules an entity's fields are stored under. */
function originOf(kind: EntityKind): ColumnOrigin {
  return kind === "component" ? "fieldGroup" : "codeFirst";
}

/**
 * How a field's value is stored: its column on each dialect, whether it moves
 * to a junction table or the translations table, and what it refers to.
 *
 * A type that is not built in is also compared by name. Plugin field types
 * register after the config is folded, so while transforms run the descriptor
 * cannot resolve one and reads it as text: a number-backed plugin type
 * retyped to `text` would otherwise compare as unchanged.
 *
 * So is a field stored as JSON. One JSON column holds a group's object, a
 * repeater's array and a chips list alike, so the column cannot tell them
 * apart; the type decides the shape of every value already stored. Types
 * that share a string column (`text` and `email`, `select` and `radio`)
 * store the same value and stay interchangeable. `password` is the
 * exception: its column is a string like `text`'s, but only a `password`
 * field's value is hashed on write and withheld from every read, so a
 * `text` field would serve its stored hashes and store new values in plain.
 *
 * A top-level field's uniqueness is part of it: the owner's rows, and its
 * code, rely on no two holding one value. Its plain `index` is not, since an
 * index changes no value and a plugin may change another's indexes.
 *
 * A nested field's value lives inside its parent's JSON, where nothing is
 * NOT NULL, so its nullability is left out: making it required changes no
 * column. A top-level field's is kept, because making one required alters
 * its column.
 */
function storageOf(
  placed: PlacedField,
  kind: EntityKind,
  localized: boolean
): unknown {
  const field = placed.field;
  const columns = DIALECTS.map(dialect => {
    const column = getColumnDescriptor(
      field as unknown as Parameters<typeof getColumnDescriptor>[0],
      dialect,
      originOf(kind)
    );
    if (column === null || !placed.nested) return column;
    return Object.fromEntries(
      Object.entries(column).filter(([key]) => key !== "nullable")
    );
  });
  const builtIn: readonly unknown[] = ALL_FIELD_TYPES;
  const storedAsJson = columns.some(
    column => column !== null && column.kind === "json"
  );
  return {
    columns,
    // A field's value is read through every container holding it, so the
    // owner of a group turning it into a repeater reshapes the values of a
    // field another plugin nested inside it.
    within: placed.within,
    typeByName:
      storedAsJson || field.type === "password" || !builtIn.includes(field.type)
        ? field.type
        : undefined,
    unique: !placed.nested && field.unique === true,
    // One value or a list of them: a `hasMany` text or select stores a JSON
    // array in the same column a single value uses, and a field group's
    // `repeatable` decides between one object and an array with no column
    // of its own to show it.
    hasMany: field.hasMany === true,
    repeatable: field.repeatable === true,
    junction: usesJunctionTable(field),
    translated:
      !placed.nested &&
      isFieldLocalized(
        field as unknown as Parameters<typeof isFieldLocalized>[0],
        localized
      ),
    relationTo: field.relationTo,
    fieldGroups: extractFieldGroupReferences(field),
  };
}

/**
 * The entity-level settings that decide its tables: its table's name, the
 * `status` column Draft/Published adds, and the `_locales` companion
 * localization adds.
 */
const TABLE_SETTINGS = ["dbName", "status", "localized"] as const;

type TableSetting = (typeof TABLE_SETTINGS)[number];

/**
 * The table each kind's entity is stored in while it sets no `dbName`, by the
 * resolvers the schema pipeline names tables with.
 */
const DEFAULT_TABLE_OF: Record<EntityKind, (slug: string) => string> = {
  collection: slug => resolveCollectionTableName(slug),
  single: slug => resolveSingleTableName({ slug }),
  component: slug => resolveComponentTableName(slug),
};

/**
 * The table settings as they are read, so a transform that restates them in
 * an equivalent form changes nothing: `status` and `localized` are on only
 * when `true`, so an explicit `false` reads as the unset setting it is, and
 * an unset `dbName` reads as the name of the default table.
 *
 * A `dbName` that is set is compared as written. The schema pipeline
 * resolves it, prefixing and normalizing it, but `i18n:restore` reads it
 * verbatim to find the `_locales` companion: `orders` and `dc_orders` are one
 * table to the first and two to the second. Only the default table's own
 * name reads as that table everywhere.
 */
function tableSettingsOf(
  kind: EntityKind,
  slug: string,
  definition: Record<string, unknown>
): Record<TableSetting, unknown> {
  const dbName = definition.dbName;
  return {
    // A blank slug names no default table, and is its own validation's to
    // refuse: an unset `dbName` then stays unset rather than resolved.
    dbName:
      dbName === undefined && slug.trim() !== ""
        ? DEFAULT_TABLE_OF[kind](slug)
        : dbName,
    status: definition.status === true,
    localized: definition.localized === true,
  };
}

/**
 * Who, other than the transforming plugin, keeps data in the entity's
 * tables: its owner, or else the first plugin that declared a field on it.
 * The app's own data is the app's to move.
 */
function tableKeeper(
  ledger: OwnershipLedger,
  plugin: TransformingPlugin
): string | undefined {
  if (ledger.owner !== undefined && ledger.owner !== plugin.name) {
    return ledger.owner;
  }
  for (const by of ledger.fields.values()) {
    if (by !== undefined && by !== plugin.name) return by;
  }
  return undefined;
}

/**
 * Refuse changing an entity's tables, moving it or turning off a setting
 * whose column or companion table holds data, while another plugin keeps
 * data there: its owner, or a plugin that added a field to it. The owner
 * moving its own table, or a plugin moving the app's, would carry that
 * plugin's stored values along. Settings are compared as the pipeline reads
 * them, so restating one in an equivalent form is not a change.
 */
function assertTableKept(
  slug: string,
  kind: EntityKind,
  ledger: OwnershipLedger,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const keeper = tableKeeper(ledger, plugin);
  if (keeper === undefined) return;
  const was = tableSettingsOf(kind, slug, before);
  const now = tableSettingsOf(kind, slug, after);
  const changed = TABLE_SETTINGS.find(
    setting => !isDeepStrictEqual(was[setting], now[setting])
  );
  if (changed === undefined) return;
  throw refusal(
    plugin,
    "TRANSFORM_TABLE_CHANGED",
    `Plugin "${plugin.name}" changes "${changed}" of "${slug}", where plugin "${keeper}" keeps data. A transform may change an entity, but not the tables another plugin's data is stored in.`
  );
}

/** The unique compound indexes an entity declares. */
function uniqueIndexes(definition: Record<string, unknown>): unknown[] {
  const indexes = definition.indexes;
  if (!Array.isArray(indexes)) return [];
  return indexes.filter(index => isRecord(index) && index.unique === true);
}

/**
 * Refuse removing or changing a unique compound index on a plugin's entity:
 * its owner's rows rely on no two sharing the indexed values, as they do on a
 * unique field. A plain index changes no value, and a plugin may change
 * another's indexes.
 */
function assertUniqueIndexesKept(
  slug: string,
  ledger: OwnershipLedger,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const owner = ledger.owner;
  if (owner === undefined || owner === plugin.name) return;
  const kept = uniqueIndexes(after);
  const lost = uniqueIndexes(before).find(
    index => !kept.some(next => isDeepStrictEqual(next, index))
  );
  if (lost === undefined) return;
  throw refusal(
    plugin,
    "TRANSFORM_TABLE_CHANGED",
    `Plugin "${plugin.name}" removes or changes a unique index of "${slug}", which plugin "${owner}" declares. A transform may change another plugin's plain indexes, but not one that keeps its owner's rows unique.`
  );
}

/**
 * Refuse removing, or changing the storage of, a field someone other than
 * the transforming plugin declared. The app's own fields are left to the
 * plugins reshaping them, since none can declare the app as a dependency.
 */
function assertFieldsKept(
  slug: string,
  kind: EntityKind,
  ledger: OwnershipLedger,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const previous = fieldsByPath(before);
  const next = fieldsByPath(after);
  for (const [path, by] of ledger.fields) {
    if (by === undefined || by === plugin.name) continue;
    const was = previous.get(path);
    const now = next.get(path);
    if (was === undefined) continue;
    const what =
      now === undefined
        ? "removes"
        : isDeepStrictEqual(
              storageOf(was, kind, before.localized === true),
              storageOf(now, kind, after.localized === true)
            )
          ? undefined
          : "changes how it stores";
    if (what === undefined) continue;
    throw refusal(
      plugin,
      "TRANSFORM_FIELD_PROTECTED",
      `Plugin "${plugin.name}" ${what} the field "${path}" of "${slug}", which plugin "${by}" declared. Only the plugin that declared a field may remove it or change how it is stored.`
    );
  }
}

/** Whether `plugin` may remove or replace what `by` contributed. */
function mayReplace(
  by: Contributor,
  ledger: OwnershipLedger,
  plugin: TransformingPlugin
): boolean {
  return (
    by === undefined ||
    by === ledger.owner ||
    by === plugin.name ||
    plugin.dependsOn.has(by)
  );
}

function protectedBehaviour(
  plugin: TransformingPlugin,
  slug: string,
  item: ContributedBehaviour,
  what: string
): NextlyError {
  return refusal(
    plugin,
    "TRANSFORM_BEHAVIOUR_PROTECTED",
    `Plugin "${plugin.name}" ${what} "${item.key}" on "${slug}", which plugin "${String(item.by)}" contributed. Declare "${String(item.by)}" in dependsOn to change it.`
  );
}

/**
 * Carry each piece of behaviour the transform kept to the new ledger, refuse
 * changing one a plugin contributed that the transforming plugin may not
 * touch, and record what the transform added as its own.
 *
 * A hook list runs in order, each hook handed what the one before returned,
 * so a protected hook is changed by being moved or repeated as surely as by
 * being removed. Protected entries must therefore appear in the order they
 * had, and none a second time. What the transforming plugin may replace (the
 * owner's, its own, a dependency's) it may also move around them.
 */
function settleBehaviour(
  slug: string,
  ledger: OwnershipLedger,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): ContributedBehaviour[] {
  const next = behaviourOf(after);
  const kept = new Map<number, Contributor>();
  // Where each key's last protected entry was found: the next one is looked
  // for only after it.
  const lastProtected = new Map<string, number>();
  for (const item of ledger.behaviour) {
    const guarded = !mayReplace(item.by, ledger, plugin);
    const from = guarded ? (lastProtected.get(item.key) ?? -1) + 1 : 0;
    const index = next.findIndex(
      (candidate, at) =>
        at >= from &&
        !kept.has(at) &&
        candidate.key === item.key &&
        isDeepStrictEqual(candidate.value, item.value)
    );
    if (index !== -1) {
      kept.set(index, item.by);
      if (guarded) lastProtected.set(item.key, index);
      continue;
    }
    if (guarded) {
      throw protectedBehaviour(
        plugin,
        slug,
        item,
        "removes, replaces or moves"
      );
    }
  }
  const repeated = ledger.behaviour.find(
    item =>
      !mayReplace(item.by, ledger, plugin) &&
      next.some(
        (candidate, at) =>
          !kept.has(at) &&
          candidate.key === item.key &&
          isDeepStrictEqual(candidate.value, item.value)
      )
  );
  if (repeated !== undefined) {
    throw protectedBehaviour(plugin, slug, repeated, "repeats");
  }
  // In the order the result holds them, so the next transform's order check
  // reads the list as it now runs.
  return next.map((candidate, at) => ({
    ...candidate,
    by: kept.has(at) ? kept.get(at) : plugin.name,
  }));
}

/** The fields after a transform: kept ones keep their declarer, new are its. */
function settleFields(
  ledger: OwnershipLedger,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): Map<string, Contributor> {
  return new Map(
    placedFields(after.fields).map(({ path }) => [
      path,
      ledger.fields.has(path) ? ledger.fields.get(path) : plugin.name,
    ])
  );
}

type ValidationErrors = ReadonlyArray<{
  path: string;
  code: string;
  message: string;
}>;

/** The refusals a direct definition of the entity would meet. */
function definitionErrors(
  kind: EntityKind,
  definition: Record<string, unknown>
): ValidationErrors {
  if (kind === "single") {
    return validateSingleConfig(definition as unknown as SingleConfig).errors;
  }
  if (kind === "component") {
    return validateFieldGroupConfig(definition as unknown as FieldGroupConfig)
      .errors;
  }
  return validateCollectionConfig(definition as unknown as CollectionConfig)
    .errors;
}

/**
 * Refuse a result the entity's own definition would be refused for, such as
 * a collection `db.idType` of `"serial"`. Only refusals the transform
 * introduced count against it: an entity a plugin assembled without
 * `defineCollection` may already carry one, and that is not this plugin's
 * doing. Each is matched by `errorIdentity`.
 */
/**
 * A refusal's identity across a transform: its code, message and path, with
 * each `fields[<index>]` in the path read as the name of the field there. A
 * transform that inserts a field moves every later field's index but not its
 * name, and one that moves a refusal onto another field changes the name.
 */
function errorIdentity(
  error: { path: string; code: string; message: string },
  definition: Record<string, unknown>
): string {
  let fields: unknown = definition.fields;
  // Only the chain that walks the entity's field tree: `indexes[0].fields[0]`
  // numbers an index's own list, not a field.
  const lead = /^fields\[\d+\](?:\.fields\[\d+\])*/.exec(error.path)?.[0] ?? "";
  const named = lead.replace(/fields\[(\d+)\]/g, (segment, index) => {
    const field: unknown = Array.isArray(fields)
      ? fields[Number(index)]
      : undefined;
    fields = isRecord(field) ? field.fields : undefined;
    return isRecord(field) && typeof field.name === "string"
      ? `fields.${field.name}`
      : segment;
  });
  const path = named + error.path.slice(lead.length);
  return `${error.code}\u0000${path}\u0000${error.message}`;
}

function assertStillValid(
  slug: string,
  kind: EntityKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const existing = definitionErrors(kind, before).map(error =>
    errorIdentity(error, before)
  );
  const introduced = definitionErrors(kind, after).filter(error => {
    const index = existing.indexOf(errorIdentity(error, after));
    if (index === -1) return true;
    existing.splice(index, 1);
    return false;
  });
  if (introduced.length === 0) return;
  throw NextlyError.validation({
    errors: introduced.map(error => ({
      path: `${plugin.path}.${error.path}`,
      code: error.code,
      message: `Plugin "${plugin.name}" makes "${slug}" invalid: ${error.message}`,
    })),
    logContext: { reason: "entity transform refused", plugin: plugin.name },
  });
}

/**
 * Judge one transform's result against the ledger and return the ledger it
 * leaves. `after` is the definition that will be registered, so a disabled
 * plugin's is judged after its behaviour has been put back.
 */
export function settleTransform(
  entity: { slug: string; kind: EntityKind },
  ledger: OwnershipLedger,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): OwnershipLedger {
  const { slug, kind } = entity;
  assertTableKept(slug, kind, ledger, before, after, plugin);
  assertUniqueIndexesKept(slug, ledger, before, after, plugin);
  assertFieldsKept(slug, kind, ledger, before, after, plugin);
  const behaviour = settleBehaviour(slug, ledger, after, plugin);
  assertStillValid(slug, kind, before, after, plugin);
  return {
    owner: ledger.owner,
    fields: settleFields(ledger, after, plugin),
    behaviour,
  };
}
