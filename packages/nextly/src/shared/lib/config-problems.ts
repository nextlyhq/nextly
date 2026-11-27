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
import { fileSystemFields } from "../../collections/config/collection-files";
import { crossEntityProblems } from "../../collections/config/cross-entity-problems";
import { systemFieldsBeside } from "../../collections/config/declared-config";
import type { CollectionConfig } from "../../collections/config/define-collection";
import { validateCollectionConfig } from "../../collections/config/validate-config";
import { isVirtualField } from "../../collections/fields/virtual";
import { fieldProducesColumn } from "../../domains/schema/field-rules";
import {
  columnsDeclaredBy,
  fieldsStoredOnRow,
} from "../../domains/schema/services/field-column-descriptor";
import { relationshipTargetSlug } from "../../domains/schema/services/relationship-target-slug";
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
 * table could not be made, so it is reported. And whether a column-less field takes the exact
 * name of a column or field Nextly keeps on the entity (`systemNameClashes`). That one is asked
 * of every entity a `define*` function declared, whether or not it added a system field: an
 * author's own text `slug` leaves none to add, and a setup may then take it away.
 */
function entryProblems<
  P extends { path: string; code: string; message: string },
>(
  entry: unknown,
  validate: (entry: unknown) => readonly P[],
  judged: JudgedEntity
): Array<P | ColumnClash> {
  const fields = (entry as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return [...validate(entry)];
  const { added, authored } = splitSystemFields(fields, judged.systemFields);
  const clashes = systemNameClashes(entry, fields, { added, authored }, judged);
  // Nothing set aside and nothing at fault: its validator's own answer, in its own order.
  if (added.length === 0 && clashes.length === 0) return [...validate(entry)];
  // Each rule is asked of the fields it is about. The rules about the author's own declarations
  // (`AUTHORED_RULES`) of the fields the author declared; every other rule, which resolves a
  // field by its name (an index, the title field, the address field), of the entity as the
  // commands use it, system fields and all.
  return [
    ...validate(entry).filter(problem => !AUTHORED_RULES.has(problem.code)),
    ...authoredProblems(entry, authored, clashes, validate),
    ...systemColumnClashes(added, authored),
    ...clashes.map(clash => clash.problem),
  ];
}

/** What an entity's check reads beside the entity itself. */
interface JudgedEntity {
  /** The system fields its `define*` call added, none where none did. */
  systemFields: readonly object[];
  /**
   * Whether its table keeps system columns, and its declaration is `define*`'s to judge: a
   * collection or a Single one of them declared. A field group has no such column, and an entity
   * written as a plain object, a Builder's definition among them, keeps its own checks.
   */
  keepsSystemColumns: boolean;
  /** Whether it is such a collection, the one kind that holds files (`holdsFiles`). */
  mayHoldFiles: boolean;
  /** The entity as the app declared it, before any plugin's setup. */
  declared: unknown;
}

/**
 * The problems of the rules about the author's own declarations (`AUTHORED_RULES`). A field
 * reported for a name Nextly keeps is left out of the one about names declared twice, so it gets
 * one answer, the same whether or not a setup was handed a copy of the field it stands beside.
 */
function authoredProblems<P extends { code: string }>(
  entry: unknown,
  authored: readonly unknown[],
  clashes: readonly NameClash[],
  validate: (entry: unknown) => readonly P[]
): P[] {
  const problemsOf = (fields: readonly unknown[]) =>
    validate({ ...(entry as object), fields }).filter(problem =>
      AUTHORED_RULES.has(problem.code)
    );
  const problems = problemsOf(authored);
  if (clashes.length === 0) return problems;
  const reported = new Set(clashes.map(clash => clash.field));
  return [
    ...problems.filter(problem => problem.code !== "FIELD_NAME_DUPLICATE"),
    // The fields as stored at the top level, so one a group with no name lays out is left out too;
    // the rule reads the top level that way itself.
    ...problemsOf(
      fieldsStoredOnRow(authored).filter(field => !reported.has(field))
    ).filter(problem => problem.code === "FIELD_NAME_DUPLICATE"),
  ];
}

/** A problem a system column or field raises of a field beside it. */
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

/** A field reported for a name Nextly keeps, and the problem reported of it. */
interface NameClash {
  field: unknown;
  problem: ColumnClash;
}

/** The names of a collection of files' own fields, which no author's field replaces. */
const FILE_FIELD_NAMES: ReadonlySet<string> = new Set(
  fileSystemFields().map(field => field.name)
);

/**
 * Each field at the document's top level that stores no column of its own (a component, a
 * field-group reference, a many-to-many, a virtual field) and takes the exact name of a column or
 * field Nextly keeps on the entity (`reservedNames`). What follows depends on the field
 * (`systemNameReason`, `FILE_NAME_REASON`); in each case the two answer to one name. The Builder
 * reserves `title` and `slug` outright; code-first keeps a field of the name that takes the column
 * (it replaces the system one), so only the column-less ones are refused. A field that takes the
 * column is `systemColumnClashes`' question.
 *
 * The fields at the top level are those `fieldsStoredOnRow` gives, the view `define*` decides by
 * (`columnsDeclaredBy`): the ones in `fields` and those a group with no name lays out beside
 * them. It passes by an entry that is not a field, which the validators report.
 */
function systemNameClashes(
  entry: unknown,
  fields: readonly unknown[],
  split: { added: readonly unknown[]; authored: readonly unknown[] },
  judged: JudgedEntity
): NameClash[] {
  if (!judged.keepsSystemColumns) return [];
  const names = reservedNames(entry, split, judged);
  const system = new Set(split.added);
  const clashes: NameClash[] = [];
  for (const field of fieldsStoredOnRow(fields)) {
    const name = sharedSystemName(field, names, system);
    if (name === null) continue;
    clashes.push({
      field,
      problem: {
        path: `${placeOf(fields, field)}.name`,
        code: "FIELD_NAME_RESERVED",
        message: nameClashMessage(name, field, entry, judged),
      },
    });
  }
  return clashes;
}

/**
 * The names `entry`'s fields may not take without a column of their own: `title` and `slug` where
 * the table carries the system column, and a collection of files' own fields.
 *
 * Asked of the fields the plugins' setups left, the added ones that survived set aside, rather
 * than of the fields `define*` added: the schema emits a system column wherever no field left
 * holds it, so a setup that removes or rewrites the added field does not free its name.
 */
function reservedNames(
  entry: unknown,
  split: { added: readonly unknown[]; authored: readonly unknown[] },
  judged: JudgedEntity
): ReadonlySet<unknown> {
  const names = new Set<unknown>(
    [
      ...split.added,
      ...systemFieldsBeside(
        split.authored as Parameters<typeof systemFieldsBeside>[0]
      ),
    ].map(field => (field as { name?: unknown }).name)
  );
  if (holdsFiles(entry, judged)) {
    for (const name of FILE_FIELD_NAMES) names.add(name);
  }
  return names;
}

/** Whether `entry` is a collection whose entries are files; a Single's `files` key means nothing. */
function holdsFiles(entry: unknown, judged: JudgedEntity): boolean {
  return (
    judged.mayHoldFiles && (entry as { files?: unknown }).files !== undefined
  );
}

/** What is reported of `field`, which takes the kept `name` without a column of its own. */
function nameClashMessage(
  name: string,
  field: unknown,
  entry: unknown,
  judged: JudgedEntity
): string {
  const ofFiles = holdsFiles(entry, judged) && FILE_FIELD_NAMES.has(name);
  const why = ofFiles ? FILE_NAME_REASON : systemNameReason(name, field);
  return `Field '${name}' stores no column of its own, so it cannot use the name '${name}': ${why} ${nameAdvice(name, ofFiles, judged.declared)}`;
}

/**
 * What to do about it. Where a plugin's setup left the field this way, the app's own declaration
 * holds no column-less field of the name, so its author would look for it in vain, may declare the
 * text field already, and cannot rename one Nextly needs: the plugin is what to change. The
 * setups' result names no plugin, so this cannot.
 */
function nameAdvice(name: string, ofFiles: boolean, declared: unknown): string {
  if (!declaresColumnLess(name, declared)) {
    return "A plugin's setup left the field this way; the app's own configuration does not hold it. Change or remove that plugin.";
  }
  return ofFiles
    ? "Rename it."
    : `Rename it, or declare '${name}' as a text field to replace Nextly's.`;
}

/** Whether `declared`, the app's own entity, holds a column-less field named `name`. */
function declaresColumnLess(name: string, declared: unknown): boolean {
  const fields = (declared as { fields?: unknown } | null)?.fields;
  const own = Array.isArray(fields) ? fieldsStoredOnRow(fields) : [];
  const names: ReadonlySet<unknown> = new Set([name]);
  return own.some(field => sharedSystemName(field, names, NO_FIELDS) !== null);
}

const NO_FIELDS: ReadonlySet<unknown> = new Set();

/** Why a file field's name is kept: each is where Nextly records one thing about a stored file. */
const FILE_NAME_REASON =
  "a collection of files keeps its own field of that name for each file, and an upload could not be recorded.";

/**
 * Why `title` or `slug` is kept. A virtual field's type is applied to the system column's value on
 * a write (a date replaces the text it is given, or stops the write); any other column-less field
 * takes the value the required column needs, and a read answers with it in the column's place.
 */
function systemNameReason(name: string, field: unknown): string {
  return isVirtualField(field as Parameters<typeof isVirtualField>[0])
    ? `the table keeps Nextly's own text column '${name}', and its type would be applied to that column's value.`
    : `the table keeps Nextly's own required text column '${name}', so no entry could be created and a stored '${name}' would be hidden.`;
}

/** The kept name `field` takes without a column of its own, or null where it takes none. */
function sharedSystemName(
  field: unknown,
  names: ReadonlySet<unknown>,
  system: ReadonlySet<unknown>
): string | null {
  if (typeof field !== "object" || field === null || system.has(field)) {
    return null;
  }
  const name = (field as { name?: unknown }).name;
  if (typeof name !== "string" || !names.has(name)) return null;
  return fieldProducesColumn(field) ? null : name;
}

/**
 * Where `target` sits in `fields`, as `fields[2]` or, inside a group with no name,
 * `fields[0].fields[1]`: the places `fieldsStoredOnRow` finds a field. Each container is entered
 * once, so a group that holds itself cannot loop.
 */
function placeOf(
  fields: readonly unknown[],
  target: unknown,
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
  effective?: ConfigEntities,
  /** `acrossEntities: false` leaves the rules across entities out: each entity alone is judged. */
  options: { acrossEntities?: boolean } = {}
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
      for (const error of entryProblems(entry, validate, {
        systemFields: record?.systemFields ?? [],
        keepsSystemColumns: byDefine && kind !== "fieldGroups",
        mayHoldFiles: byDefine && kind === "collections",
        declared: declaredEntries[index],
      })) {
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
  if (options.acrossEntities === false) return problems;
  for (const problem of crossEntityProblems({
    collections,
    singles,
    fieldGroups,
  })) {
    problems.push({ ...problem, declaredByDefine: false, crossEntity: true });
  }
  return problems;
}

/**
 * What the Builder saves that the code rules refuse, so its definitions are not refused for it:
 * a collection with no fields of its own (its system fields come at runtime), and an address the
 * address rule judges (`shared/address-rule`), which the Builder's save and the migrate commands
 * ask only of a new or changed address, as they know which are; one that already exists keeps
 * working. A slug that is missing or not a string is still reported: the Builder never writes one.
 * A field named by a SQL keyword (`select`, `order`) too: the Builder's field save takes one
 * (`applySchemaChanges`), though creating a collection with one is refused.
 * A repeater or group marked translatable as a whole is not among them, though the Builder saves
 * the mark: it is taken out of the file by hand, before an upgrade runs over it.
 */
const BUILDER_ALLOWS: ReadonlySet<string> = new Set([
  "FIELDS_EMPTY",
  "FIELD_NAME_SQL_KEYWORD",
  "SLUG_INVALID_FORMAT",
  "SLUG_TOO_LONG",
  "SLUG_RESERVED",
  "SLUG_SQL_KEYWORD",
  "SLUG_SAME_SNAKE_CASE",
]);

/**
 * `entity` with each relationship's target as the Builder reads it (`relationshipTargetSlug`):
 * a field the earlier Builder stored with its target in `options.target` and no `relationTo` is
 * judged as naming that target, nested ones included.
 */
function withTargetsAsBuilderReads(entity: unknown): unknown {
  if (typeof entity !== "object" || entity === null) return entity;
  const fields = (entity as { fields?: unknown }).fields;
  return Array.isArray(fields)
    ? { ...entity, fields: fieldsWithTargetsAsBuilderReads(fields) }
    : entity;
}

function fieldsWithTargetsAsBuilderReads(
  fields: readonly unknown[]
): unknown[] {
  return fields.map(field => {
    if (typeof field !== "object" || field === null) return field;
    const record = field as Record<string, unknown>;
    // The one reader of a target decides: a named `relationTo` answers itself, a list none.
    const target = relationshipTargetSlug(record);
    const read = target === null ? record : { ...record, relationTo: target };
    return Array.isArray(read.fields)
      ? { ...read, fields: fieldsWithTargetsAsBuilderReads(read.fields) }
      : read;
  });
}

/**
 * Whether `problem` is the missing name of a group that only lays its fields out: the one field
 * the definition format lets go without a name (`ui-schema.ts`), whose fields are stored where it
 * sits. A collection's and a field group's field saves take one, and every create takes one inside
 * a container. A Single's saves refuse one at its top level; one there was written by hand, is
 * served, and is not refused either, so a file that works keeps working. The code rules ask every
 * field for a name; a nameless field of any other type is reported.
 */
function isLayoutGroupName(
  lists: Readonly<Record<string, readonly unknown[]>>,
  problem: ConfigProblem
): boolean {
  if (
    problem.code !== "FIELD_NAME_REQUIRED" ||
    !problem.path.endsWith(".name")
  ) {
    return false;
  }
  const field = entryAt(lists, problem.path.slice(0, -".name".length));
  return (
    typeof field === "object" &&
    field !== null &&
    (field as { type?: unknown }).type === "group" &&
    (field as { name?: unknown }).name === undefined
  );
}

/**
 * Whether `problem` is the mark of a field placing a field group: the Builder saves it, and it is
 * left as it is in the definition file.
 */
function isComponentMark(
  lists: Readonly<Record<string, readonly unknown[]>>,
  problem: ConfigProblem
): boolean {
  if (problem.code !== "FIELD_STRUCTURE_NOT_TRANSLATABLE") return false;
  const field = entryAt(lists, problem.path.slice(0, -".localized".length));
  const type = (field as { type?: unknown } | undefined)?.type;
  return type === "component" || type === "fieldGroup";
}

/** What `path` (`collections[0].fields[2]`) names inside `root`, or undefined. */
function entryAt(root: unknown, path: string): unknown {
  let at = root;
  for (const [, key, index] of path.matchAll(
    /\.?([A-Za-z_$][\w$]*)(?:\[(\d+)\])?/g
  )) {
    at =
      typeof at === "object" && at !== null
        ? (at as Record<string, unknown>)[key]
        : undefined;
    if (index !== undefined) {
      at = Array.isArray(at) ? at[Number(index)] : undefined;
    }
  }
  return at;
}

/** The Builder's definitions, as the definition file holds them. */
export interface BuilderDefinitionEntities {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  components?: readonly unknown[];
}

/**
 * What else is said of `code` in `file`, after the rule's own sentence. The mark on a container is
 * the one problem whose fix in the file makes a change to migrate: the rule's sentence is written
 * for the configuration, and names the upgrade alone.
 */
function editOf(code: string, file: string): string {
  return code === "FIELD_STRUCTURE_NOT_TRANSLATABLE"
    ? ` Edit it in ${file}, then run \`nextly migrate:create\` and \`nextly migrate\`.`
    : "";
}

/**
 * Every problem in the Builder's definitions that the same per-entity rules find, each at its
 * place in the definition file (`ui-schema.json collections[0].slug`), except what the Builder
 * itself saves (`BUILDER_ALLOWS`). An entry a code-first entity of its kind shadows is not
 * judged: the code definition is the one used, as the Builder merge decides (one slug, one kind).
 */
export function builderDefinitionProblems(
  builder: BuilderDefinitionEntities,
  code: ConfigEntities,
  definitionFile: string
): ConfigProblem[] {
  const file = definitionFile.replace(/^\.\//, "");
  const lists = {
    collections: builder.collections ?? [],
    singles: builder.singles ?? [],
    fieldGroups: builder.components ?? [],
  };
  const codeSlugs = {
    collections: new Set((code.collections ?? []).map(slugOf)),
    singles: new Set((code.singles ?? []).map(slugOf)),
    fieldGroups: new Set((code.fieldGroups ?? []).map(slugOf)),
  };
  // Each entry is judged in place, so a problem keeps its index in the file; one a code-first
  // entity shadows has its problems set aside.
  const shadowed = (path: string): boolean => {
    const match = /^(collections|singles|fieldGroups)\[(\d+)\]/.exec(path);
    if (match === null) return false;
    const kind = match[1] as keyof typeof lists;
    const slug = slugOf(lists[kind][Number(match[2])]);
    return slug !== undefined && codeSlugs[kind].has(slug);
  };
  return configurationProblems(
    {
      collections: lists.collections.map(withTargetsAsBuilderReads),
      singles: lists.singles.map(withTargetsAsBuilderReads),
      fieldGroups: lists.fieldGroups.map(withTargetsAsBuilderReads),
    },
    undefined,
    { acrossEntities: false }
  )
    .filter(
      problem =>
        !BUILDER_ALLOWS.has(problem.code) &&
        !shadowed(problem.path) &&
        !isLayoutGroupName(lists, problem) &&
        !isComponentMark(lists, problem)
    )
    .map(problem => ({
      ...problem,
      message: problem.message + editOf(problem.code, file),
      // The file names field groups `components`.
      path: `${file} ${problem.path.replace(/^fieldGroups\[/, "components[")}`,
    }));
}
