/**
 * Every problem in a configuration, found by the rules that judge each entity, in the order the
 * configuration declares them.
 *
 * Each entity kind already has a validator that collects all of its errors without throwing
 * (`validateCollectionConfig`, `validateSingleConfig`, `validateFieldGroupConfig`), and the field
 * types are judged by `fieldDeclarationIssues`. This reads them all together, so a configuration
 * with problems in several entities is reported whole rather than one throw at a time. It decides
 * nothing of its own: a rule lives in its validator, and this only places each finding in the
 * configuration.
 *
 * @module shared/lib/config-problems
 */
import { crossEntityProblems } from "../../collections/config/cross-entity-problems";
import type { CollectionConfig } from "../../collections/config/define-collection";
import { validateCollectionConfig } from "../../collections/config/validate-config";
import { fieldProducesColumn } from "../../domains/schema/field-rules";
import {
  columnsDeclaredBy,
  fieldsStoredOnRow,
} from "../../domains/schema/services/field-column-descriptor";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import type { SingleConfig } from "../../singles/config/types";
import { validateSingleConfig } from "../../singles/config/validate-single";

import { fieldDeclarationIssues } from "./assert-plugin-field-declarations";
import { declaredPlaceOf } from "./declared-entity-trace";

/** One problem in a configuration: where it is, which rule it breaks, and what the rule says. */
export interface ConfigProblem {
  /** Where in the configuration, as `collections[1].fields`: the entity by its position. */
  path: string;
  code: string;
  message: string;
  /**
   * Whether the entity was declared through its `define*` function (`markDeclaredByDefine`)
   * rather than written as a plain object. A start refuses the first and warns about the second,
   * which the start never judged before.
   */
  declaredByDefine: boolean;
  /**
   * Whether it breaks a rule across entities (`crossEntityProblems`): one slug each, one table
   * per field group, one Single per address, no cycle among field groups. `defineConfig` refused
   * these at import, whatever declared the entities, so a start refuses them still.
   */
  crossEntity?: boolean;
}

/** The configuration's entities, as far as finding their problems reads them. */
export interface ConfigEntities {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}

/**
 * The mark a `define*` function leaves on every entity it returns, recording the system fields
 * (`title`, `slug`) it added. A registered symbol, so a second copy of this module (the
 * configuration's bundle beside the runtime's) reads the same one; not enumerable, so no
 * comparison, serialisation or settings record of the entity sees it. The configuration keeps the
 * entity objects the app declared, so the mark is read on them. The fields themselves carry
 * nothing, so every comparison of them is as it was.
 */
const DECLARED_BY_DEFINE = Symbol.for("nextly.config.declaredByDefine");

/** What the mark records of the `define*` call that returned the entity. */
interface DefineRecord {
  /** The system fields the call added, as it added them. */
  systemFields: readonly object[];
}

/** `entity`, marked as one its `define*` function returned, having added `systemFields`. */
export function markDeclaredByDefine<T extends object>(
  entity: T,
  systemFields: readonly object[] = []
): T {
  const record: DefineRecord = Object.freeze({
    systemFields: Object.freeze([...systemFields]),
  });
  Object.defineProperty(entity, DECLARED_BY_DEFINE, { value: record });
  return entity;
}

/** The record `markDeclaredByDefine` left on `entity`, or undefined where it left none. */
function defineRecordOf(entity: unknown): DefineRecord | undefined {
  if (typeof entity !== "object" || entity === null) return undefined;
  const record = (entity as Record<symbol, unknown>)[DECLARED_BY_DEFINE];
  return typeof record === "object" && record !== null
    ? (record as DefineRecord)
    : undefined;
}

/**
 * Whether `field` is one of `systemFields`, or a copy of one: the same settings, each the same
 * value. A plugin's setup may hand back a copy (`{ ...field }`, or the copy it was handed), and
 * a field it adds of the same name declares settings of its own, so it is not one.
 */
function isSystemField(
  field: unknown,
  systemFields: readonly object[]
): boolean {
  if (typeof field !== "object" || field === null) return false;
  const keys = Object.keys(field);
  return systemFields.some(
    added =>
      added === field ||
      (Object.keys(added).length === keys.length &&
        keys.every(
          key =>
            (added as Record<string, unknown>)[key] ===
            (field as Record<string, unknown>)[key]
        ))
  );
}

/**
 * The rules about the fields an author declared, asked of those alone: that there is at least
 * one, and that no two of them are one field declared twice (the sibling-field rule). A system
 * field beside them is not the author's; whether one of theirs takes its column is asked below.
 */
const AUTHORED_RULES: ReadonlySet<string> = new Set([
  "FIELDS_EMPTY",
  "FIELD_NAME_DUPLICATE",
]);

/**
 * The problems of `entry`. The rules about the author's own declarations are its validator's, of
 * the fields its author declared, the system
 * fields its `define*` call added set aside (`isSystemField`), as the rules judged it when that
 * call threw. A collection with no field of its own breaks the rule that it declare one, and an
 * author's field may share a system field's name where it takes no column of its own (a
 * column-less `Title` beside the added `title`), which the rules would otherwise call one name
 * declared twice.
 *
 * And the two questions the system fields raise beside them: whether another field takes a column
 * one of them holds, asked as `defineCollection` asks it before adding them
 * (`columnsDeclaredBy`). A field a plugin's setup adds by a system field's name does, and the
 * table could not be made, so it is reported. And whether a column-less field takes one's exact
 * name (`systemNameClashes`), so the two would share one document key.
 */

function entryProblems<
  P extends { path: string; code: string; message: string },
>(
  entry: unknown,
  validate: (entry: unknown) => readonly P[],
  systemFields: readonly object[]
): Array<P | ColumnClash> {
  const fields = (entry as { fields?: unknown } | null)?.fields;
  if (systemFields.length === 0 || !Array.isArray(fields)) {
    return [...validate(entry)];
  }
  const { added, authored } = splitSystemFields(fields, systemFields);
  // Each rule is asked of the fields it is about. The rules about the author's own declarations
  // (`AUTHORED_RULES`) of the fields the author declared; every other rule, which resolves a
  // field by its name (an index, the title field, the address field), of the entity as the
  // commands use it, system fields and all.
  return [
    ...validate(entry).filter(problem => !AUTHORED_RULES.has(problem.code)),
    ...validate({ ...(entry as object), fields: authored }).filter(problem =>
      AUTHORED_RULES.has(problem.code)
    ),
    ...systemColumnClashes(added, authored),
    ...systemNameClashes(fields, added),
  ];
}

/** A field that takes a column, or the exact name, a system field holds. */
interface ColumnClash {
  path: string;
  code: string;
  message: string;
}

/**
 * `fields`, split into the system fields the `define*` call added and the author's. Each system
 * field is matched once: a second copy of one (a setup's own `{ ...title }`) is the author's.
 */
function splitSystemFields(
  fields: readonly unknown[],
  systemFields: readonly object[]
): { added: unknown[]; authored: unknown[] } {
  const unmatched = [...systemFields];
  const added: unknown[] = [];
  const authored: unknown[] = [];
  for (const field of fields) {
    const at = unmatched.findIndex(system => isSystemField(field, [system]));
    if (at === -1) {
      authored.push(field);
      continue;
    }
    added.push(field);
    unmatched.splice(at, 1);
  }
  return { added, authored };
}

/** Each of `authored` that takes a column one of `added` holds, asked as `defineCollection` asks. */
function systemColumnClashes(
  added: readonly unknown[],
  authored: readonly unknown[]
): ColumnClash[] {
  const nameOf = (field: unknown) => String((field as { name?: unknown }).name);
  const clashes: ColumnClash[] = [];
  for (const system of added) {
    const [column] = columnsDeclaredBy([system as { name?: unknown }]);
    if (column === undefined) continue;
    for (const field of authored) {
      if (!columnsDeclaredBy([field as { name?: unknown }]).has(column))
        continue;
      clashes.push({
        path: "fields",
        code: "FIELD_NAME_DUPLICATE",
        message: `Field '${nameOf(field)}' takes the column '${column}', which the system field '${nameOf(system)}' already holds. Rename it.`,
      });
    }
  }
  return clashes;
}

/**
 * Each author's field stored at the document's top level that takes the exact name of one of
 * `added` but stores no column of its own (a component, a field-group reference, a many-to-many,
 * a virtual field). `define*` adds a system field when no field holds its column, so it adds one
 * beside such a field, and the two would read and write one document key: a write offered to
 * both, a read answered by one. The Builder reserves these names outright; code-first keeps a
 * field of the name that takes the column (it replaces the system one), so only the column-less
 * ones are refused. A field that takes the column is `systemColumnClashes`' question.
 *
 * The fields at the top level are those `fieldsStoredOnRow` gives, the view `define*` decides by
 * (`columnsDeclaredBy`): the ones in `fields` and those a group with no name lays out beside
 * them. It passes by an entry that is not a field, which the validators report.
 */
function systemNameClashes(
  fields: readonly unknown[],
  added: readonly unknown[]
): ColumnClash[] {
  const systemNames = new Set(
    added.map(field => (field as { name?: unknown }).name)
  );
  const system = new Set(added);
  const clashes: ColumnClash[] = [];
  for (const field of fieldsStoredOnRow(fields)) {
    const name = sharedSystemName(field, systemNames, system);
    if (name === null) continue;
    clashes.push({
      path: `${placeOf(fields, field)}.name`,
      code: "FIELD_NAME_RESERVED",
      message: `Field '${name}' stores no column of its own, so it cannot use the name '${name}': Nextly keeps its own text field '${name}' on every collection and Single, and the two would share one document key. Rename it, or declare '${name}' as a text field to replace Nextly's.`,
    });
  }
  return clashes;
}

/** The system name `field` takes without a column of its own, or null where it takes none. */
function sharedSystemName(
  field: unknown,
  systemNames: ReadonlySet<unknown>,
  system: ReadonlySet<unknown>
): string | null {
  if (typeof field !== "object" || field === null || system.has(field)) {
    return null;
  }
  const name = (field as { name?: unknown }).name;
  if (typeof name !== "string" || !systemNames.has(name)) return null;
  return fieldProducesColumn(field as Parameters<typeof fieldProducesColumn>[0])
    ? null
    : name;
}

/**
 * Where `target` sits in `fields`, as `fields[2]` or, inside a group with no name,
 * `fields[0].fields[1]`: the places `fieldsStoredOnRow` finds a field. Each container is entered
 * once, so a group that holds itself cannot loop.
 */
function placeOf(
  fields: readonly unknown[],
  target: object,
  at = "fields",
  entered: WeakSet<object> = new WeakSet()
): string {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field === target) return `${at}[${i}]`;
    const inner = unnamedContainerFields(field);
    if (inner === null || entered.has(inner)) continue;
    entered.add(inner);
    const found = placeOf(inner, target, `${at}[${i}].fields`, entered);
    if (found !== `${at}[${i}].fields`) return found;
  }
  return at;
}

/** The fields a group with no name holds, or null where `field` is not one. */
function unnamedContainerFields(field: unknown): readonly unknown[] | null {
  if (typeof field !== "object" || field === null) return null;
  const { name, fields } = field as { name?: unknown; fields?: unknown };
  const named = typeof name === "string" && name.length > 0;
  return !named && Array.isArray(fields) ? fields : null;
}

/** `path` within the entity at `kind[index]`, as a path in the whole configuration. */
function within(kind: string, index: number, path: string): string {
  const entity = `${kind}[${index}]`;
  return path === "" ? entity : `${entity}.${path}`;
}

/** An entity's slug, when it has one that is a string. */
function slugOf(entity: unknown): string | undefined {
  const slug = (entity as { slug?: unknown } | null)?.slug;
  return typeof slug === "string" ? slug : undefined;
}

/**
 * Each of the app's `declared` entities as `effective` holds it, where a plugin's setup changed
 * it, else as declared: the form a command uses, in the app's own order. An entity a setup added
 * is a plugin's contribution and keeps its own checks, so it is not among them.
 *
 * Found by the place the copy a setup was handed carries (`traceDeclaredEntities`), which
 * follows an entity a setup renamed; then, for an entity a setup rebuilt without spreading that
 * copy, by its slug. One found neither way is judged as declared, so the check never passes an
 * entity it could not find.
 */
function asUsed(
  kind: string,
  declared: readonly unknown[],
  effective: readonly unknown[] | undefined
): unknown[] {
  if (effective === undefined) return [...declared];
  // Where nothing transformed the configuration, the effective entities are the declared ones:
  // each is itself, so two with one slug are each judged as themselves.
  const held = new Set<unknown>(effective);
  const byPlace = new Map<string, unknown>();
  const bySlug = new Map<string, unknown>();
  for (const entity of effective) {
    const place = declaredPlaceOf(entity);
    if (place !== undefined) {
      if (!byPlace.has(place)) byPlace.set(place, entity);
      continue;
    }
    const slug = slugOf(entity);
    if (slug !== undefined && !bySlug.has(slug)) bySlug.set(slug, entity);
  }
  return declared.map((entity, index) => {
    if (held.has(entity)) return entity;
    const traced = byPlace.get(`${kind}[${index}]`);
    if (traced !== undefined) return traced;
    const slug = slugOf(entity);
    return (slug === undefined ? undefined : bySlug.get(slug)) ?? entity;
  });
}

/**
 * Every problem in the app's collections, Singles and field groups, each placed by the entity's
 * position in `declared`. Each is judged as `effective` holds it, where given: the configuration
 * after the plugins' setups, which is what the commands use. An entity's own problems come before
 * the next entity's, collections first, then Singles, then field groups; each entity's field-type
 * problems follow its other ones.
 *
 * A relationship's target is not judged here: the load and the start resolve targets with every
 * one known, Nextly's own (`users`, `media`), the plugins' and the Schema Builder's.
 */
export function configurationProblems(
  declared: ConfigEntities,
  effective?: ConfigEntities
): ConfigProblem[] {
  const collections = asUsed(
    "collections",
    declared.collections ?? [],
    effective?.collections
  );
  const singles = asUsed("singles", declared.singles ?? [], effective?.singles);
  const fieldGroups = asUsed(
    "fieldGroups",
    declared.fieldGroups ?? [],
    effective?.fieldGroups
  );

  // Only a type nothing offers: a registered type's option problems, and a missing type, are
  // each validator's own.
  const fieldTypes = fieldDeclarationIssues(
    {
      collections: collections as CollectionConfig[],
      singles: singles as SingleConfig[],
      fieldGroups: fieldGroups as FieldGroupConfig[],
    },
    (kind, index) => `${kind}[${index}]`,
    { options: false, missingType: false }
  );

  // Each kind with the validator that judges it, in the order problems are listed.
  const kinds: ReadonlyArray<
    [
      "collections" | "singles" | "fieldGroups",
      readonly unknown[],
      (
        entry: unknown
      ) => ReadonlyArray<Omit<ConfigProblem, "declaredByDefine">>,
    ]
  > = [
    [
      "collections",
      collections,
      entry => validateCollectionConfig(entry as CollectionConfig).errors,
    ],
    [
      "singles",
      singles,
      entry => validateSingleConfig(entry as SingleConfig).errors,
    ],
    [
      "fieldGroups",
      fieldGroups,
      entry => validateFieldGroupConfig(entry as FieldGroupConfig).errors,
    ],
  ];

  const problems: ConfigProblem[] = [];
  for (const [kind, entries, validate] of kinds) {
    const declaredEntries = declared[kind] ?? [];
    entries.forEach((entry, index) => {
      // The mark is on the entity the app declared; a setup's copy of it does not carry it.
      const record = defineRecordOf(declaredEntries[index]);
      const byDefine = record !== undefined;
      for (const error of entryProblems(
        entry,
        validate,
        record?.systemFields ?? []
      )) {
        problems.push({
          ...error,
          path: within(kind, index, error.path),
          declaredByDefine: byDefine,
        });
      }
      for (const issue of fieldTypes) {
        if (
          issue.path === `${kind}[${index}]` ||
          issue.path.startsWith(`${kind}[${index}].`)
        ) {
          problems.push({ ...issue, declaredByDefine: byDefine });
        }
      }
    });
  }
  // The rules across entities, judged over the entities as the commands use them.
  for (const problem of crossEntityProblems({
    collections,
    singles,
    fieldGroups,
  })) {
    problems.push({ ...problem, declaredByDefine: false, crossEntity: true });
  }
  return problems;
}
