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
import { extractFieldGroupReferences } from "../domains/field-groups/storage/field-group-field-type";
import { isFieldLocalized } from "../domains/i18n/classify-fields";
import {
  getColumnDescriptor,
  usesJunctionTable,
  type ColumnOrigin,
  type SupportedDialect,
} from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors/nextly-error";
import type { FieldGroupConfig } from "../field-groups/config/types";
import { validateFieldGroupConfig } from "../field-groups/config/validate-field-group";
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
function placedFields(fields: unknown, prefix = ""): PlacedField[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    if (!isRecord(field) || typeof field.name !== "string") return [];
    const path = prefix === "" ? field.name : `${prefix}.${field.name}`;
    return [
      { path, field, nested: prefix !== "" },
      ...placedFields(field.fields, path),
    ];
  });
}

function fieldsByPath(definition: Record<string, unknown>) {
  return new Map(placedFields(definition.fields).map(p => [p.path, p]));
}

/** The keys of an entity or field whose values are behaviour, not storage. */
const RULE_BLOCKS = ["access", "admin"] as const;

/**
 * Each access rule, hook, validator and admin setting on `node`, keyed by
 * where it sits: one entry per access operation and per admin setting, and
 * one per hook in each hook list, so adding a hook beside another's removes
 * nothing.
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
  if (node.validate !== undefined) {
    found.push({ key: `${at}validate`, value: node.validate });
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
  return {
    columns,
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

/** Refuse moving a plugin's entity to another table. */
function assertTableKept(
  slug: string,
  ledger: OwnershipLedger,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const owner = ledger.owner;
  if (owner === undefined || owner === plugin.name) return;
  if (isDeepStrictEqual(before.dbName, after.dbName)) return;
  throw refusal(
    plugin,
    "TRANSFORM_TABLE_CHANGED",
    `Plugin "${plugin.name}" changes the table of "${slug}", which plugin "${owner}" declares. A transform may change another plugin's entity, but not where it is stored.`
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

/**
 * Carry each piece of behaviour the transform kept to the new ledger, refuse
 * removing or replacing one a plugin contributed that the transforming plugin
 * may not touch, and record what the transform added as its own.
 */
function settleBehaviour(
  slug: string,
  ledger: OwnershipLedger,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): ContributedBehaviour[] {
  const unclaimed = behaviourOf(after);
  const settled: ContributedBehaviour[] = [];
  for (const item of ledger.behaviour) {
    const index = unclaimed.findIndex(
      next => next.key === item.key && isDeepStrictEqual(next.value, item.value)
    );
    if (index !== -1) {
      settled.push({ ...item });
      unclaimed.splice(index, 1);
      continue;
    }
    if (mayReplace(item.by, ledger, plugin)) continue;
    throw refusal(
      plugin,
      "TRANSFORM_BEHAVIOUR_PROTECTED",
      `Plugin "${plugin.name}" removes or replaces "${item.key}" on "${slug}", which plugin "${String(item.by)}" contributed. Declare "${String(item.by)}" in dependsOn to change it.`
    );
  }
  return [...settled, ...unclaimed.map(item => ({ ...item, by: plugin.name }))];
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
 * doing. Compared by code and message, not path, because a transform that
 * inserts a field moves every later field's path.
 */
function assertStillValid(
  slug: string,
  kind: EntityKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  plugin: TransformingPlugin
): void {
  const existing = definitionErrors(kind, before).map(
    error => `${error.code}\u0000${error.message}`
  );
  const introduced = definitionErrors(kind, after).filter(error => {
    const index = existing.indexOf(`${error.code}\u0000${error.message}`);
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
  assertTableKept(slug, ledger, before, after, plugin);
  assertFieldsKept(slug, kind, ledger, before, after, plugin);
  const behaviour = settleBehaviour(slug, ledger, after, plugin);
  assertStillValid(slug, kind, before, after, plugin);
  return {
    owner: ledger.owner,
    fields: settleFields(ledger, after, plugin),
    behaviour,
  };
}
