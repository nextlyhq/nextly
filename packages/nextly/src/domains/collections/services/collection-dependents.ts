/**
 * What depends on a collection, a Single or a field group, and the refusal
 * that keeps it from being deleted while anything does.
 *
 * Three things can depend on one, and deleting it breaks each:
 *
 * - **A field that names it**, in another collection, a Single or a field
 *   group, at any depth inside repeaters and groups: a relationship or upload
 *   pointing at a collection, or a field placing a field group. Deleting the
 *   collection leaves the field pointing at nothing, and each database does
 *   something different with the rows: PostgreSQL drops the table with
 *   `CASCADE` and strips the other table's foreign key, MySQL refuses partway
 *   through, SQLite leaves links to rows that are gone. Deleting the field
 *   group leaves the field placing nothing, its stored values gone with the
 *   field group's table. No field names a Single.
 * - **A foreign key that a plugin or the app declares** on a table of its own
 *   and points at one of the entity's tables.
 * - **Another owner's element on one of its tables**: a hidden column, an
 *   index, a foreign key or a check a plugin or the app added. Dropping the
 *   table takes it, with its values.
 *
 * The rule is the same for all three, for every kind of entity and on every
 * database: refuse before anything is removed, and name each dependent with
 * what to do about it. One check answers for the three kinds, so a
 * collection, a Single and a field group are refused for the same things in
 * the same words.
 *
 * It fails closed. A registry that does not exist yet has nothing in it, but
 * any other failure to read one, a stored field list that does not parse, or
 * a failure to read the declared foreign keys or the record of other owners'
 * elements stops the delete: a guard against losing data that answers
 * "nothing depends on it" about a record it could not read has not checked.
 *
 * Dependents deleted in the same operation do not count: an entity's
 * references to itself go with it, and so do those of entities deleted with
 * it.
 *
 * @module domains/collections/services/collection-dependents
 */

import { typeHasNestedFields } from "../../../collections/fields/guards";
import { NextlyError } from "../../../errors/nextly-error";
import { addressableFields } from "../../../shared/addressable-fields";
import { isMissingTable } from "../../field-groups/migration/session";
import { fieldGroupPlacements } from "../../field-groups/storage/field-group-placements";
import {
  resolveFieldGroupRegistryName,
  type StorageNameAdapter,
} from "../../field-groups/storage/resolve-storage-names";
import {
  describeOwner,
  distinctElements,
  elementsAddedTo,
  foreignKeysInto,
  readLiveKeysInto,
  readRecordedElementsOn,
  type ElementOnTable,
  type ExtensionSchemaRecord,
  type ForeignKeyInto,
  type LiveKeyInto,
} from "../../schema/ownership/dependent-elements";
import { ELEMENT_NOUNS } from "../../schema/ownership/owner-registry";
import { parseJsonIfString } from "../../singles/services/single-utils";

/** The kinds of entity that hold fields, and that a delete removes. */
export type EntityKind = "collection" | "single" | "fieldGroup";

/** One field that names an entity being deleted. */
export interface FieldReference {
  readonly entityType: EntityKind;
  readonly entitySlug: string;
  /** The field's path from its entity's top level, dotted through repeaters and groups. */
  readonly fieldPath: string;
}

/** An entity that can hold fields, with the field list it stores. */
export interface FieldOwner {
  readonly entityType: EntityKind;
  readonly entitySlug: string;
  readonly fields: readonly unknown[];
}

/** A collection, Single or field group about to be deleted, and every table it owns. */
export interface EntityToDelete {
  /** Which kind it is, which decides what a field names it by. A collection unless said. */
  readonly kind?: EntityKind;
  /** What a refusal calls it. */
  readonly slug: string;
  /**
   * Its own table, its translation table and, for a collection or a Single,
   * its junction tables.
   */
  readonly tables: readonly string[];
  /**
   * The slug fields name it by, when that is not `slug`; `null` when no field
   * can name it. A command that knows a removed collection only by its table
   * calls it by a name read off the table, which may be a surviving
   * collection's slug: matching fields against it would count the survivor's
   * references as this collection's.
   */
  readonly fieldSlug?: string | null;
}

/** How a set of deletes is judged. */
export interface DependentsOptions {
  /**
   * The collections whose fields go with the set, so they point at nothing
   * afterwards and are no reason to refuse. Every collection in the set
   * unless the caller knows better: a command that names a removed
   * collection only by what its table reads as passes the slugs it knows,
   * so a surviving collection of that name keeps its fields counted. The
   * Singles and field groups of the set go with it either way.
   */
  readonly fieldsGoWith?: readonly string[];
}

/** What depends on one entity. Empty lists mean nothing of that kind does. */
export interface EntityDependents {
  /** The kind of the entity depended on, which decides how a refusal words its fields. */
  readonly kind: EntityKind;
  readonly fields: readonly FieldReference[];
  readonly foreignKeys: readonly ForeignKeyInto[];
  /**
   * Keys the database holds into its tables that no configuration declares:
   * a key whose owner stopped declaring it, until a migration removes it.
   * Asked of a Single or field group, whose tables nothing of Nextly's own
   * points into from outside them.
   */
  readonly retainedKeys: readonly LiveKeyInto[];
  readonly elements: readonly ElementOnTable[];
}

/**
 * Where the three kinds of dependent are read from. Each read either answers
 * or throws; a throw makes the delete refuse.
 */
export interface DependentsSources {
  /** Every collection, Single and field group with its stored field list. */
  fieldOwners(): Promise<readonly FieldOwner[]>;
  /**
   * The compiled extension schema: the foreign keys plugins and the app
   * declare, and the elements they add to entity tables. `null` when nothing
   * declares any schema.
   */
  extensionSchema(): Promise<ExtensionSchemaRecord | null>;
  /** The element rows recorded for these tables in `nextly_schema_owners`. */
  recordedElements(
    tables: readonly string[]
  ): Promise<readonly ElementOnTable[]>;
  /**
   * The foreign keys the database's catalog holds into these tables, from
   * any table. Absent where no database is read, as for a command that judges
   * a migration file; then only declared keys are asked about.
   */
  liveKeysInto?(tables: readonly string[]): Promise<readonly LiveKeyInto[]>;
}

/** Field types whose target names the collection a value points at. */
const REFERENCING_FIELD_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "upload",
]);

/** The slugs in a target that is one slug or a list of them. */
function slugsIn(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (!Array.isArray(target)) return [];
  return target.filter((slug): slug is string => typeof slug === "string");
}

/**
 * The collections a stored field points at. A code-first field names them in
 * `relationTo`; a Builder field keeps them in `options.target`. Both are read,
 * since a row may come from either road.
 */
function targetsOf(field: Record<string, unknown>): string[] {
  const options = field.options;
  const builderTarget =
    typeof options === "object" && options !== null
      ? (options as { target?: unknown }).target
      : undefined;
  return [...slugsIn(field.relationTo), ...slugsIn(builderTarget)];
}

/** A relationship or upload field in a stored field list, with what it points at. */
export interface ReferencingField {
  /** The field's path from its entity's top level, dotted through repeaters and groups. */
  readonly path: string;
  /** The collections it points at. */
  readonly targets: readonly string[];
}

/**
 * Every relationship and upload field in a field list, at any depth inside
 * repeaters and groups, with the collections each points at. A group with no
 * name is looked through (`addressableFields`), and its fields are named at
 * the level they are stored. The one walk every question about what a field
 * list points at derives from.
 *
 * @param fields a stored field list, as parsed from a registry row
 * @param parentPath the path of the container these fields sit in
 */
export function referencingFields(
  fields: unknown,
  parentPath = ""
): ReferencingField[] {
  const found: ReferencingField[] = [];
  // The fields stored at this level: a group with no name only lays fields
  // out, so its fields are stored here and are read here, under this path.
  // Skipping it for having no name would miss every reference inside it.
  for (const field of addressableFields(fields)) {
    const record = field as Record<string, unknown>;
    const { name, type, fields: children } = record;
    if (typeof name !== "string" || name === "" || typeof type !== "string") {
      continue;
    }
    const path = parentPath === "" ? name : `${parentPath}.${name}`;
    if (REFERENCING_FIELD_TYPES.has(type)) {
      found.push({ path, targets: targetsOf(record) });
    }
    if (typeHasNestedFields(type)) {
      found.push(...referencingFields(children, path));
    }
  }
  return found;
}

/**
 * The paths of every field in a field list that points at `slug`, at any depth.
 *
 * @param fields a stored field list, as parsed from a registry row
 * @param slug the collection being deleted
 */
export function fieldsPointingAt(fields: unknown, slug: string): string[] {
  return referencingFields(fields)
    .filter(field => field.targets.includes(slug))
    .map(field => field.path);
}

/**
 * The paths of every field in a field list that places the field group
 * `slug`, at any depth, in either spelling of the field type and of its
 * reference keys.
 *
 * @param fields a stored field list, as parsed from a registry row
 * @param slug the field group being deleted
 */
export function fieldsPlacing(fields: unknown, slug: string): string[] {
  return fieldGroupPlacements(fields)
    .filter(placement => placement.slugs.includes(slug))
    .map(placement => placement.path);
}

/**
 * The paths of the fields in a field list that name an entity of `kind`
 * called `slug`: a relationship or upload pointing at a collection, or a
 * field placing a field group. No field names a Single.
 */
function fieldsNaming(fields: unknown, kind: EntityKind, slug: string) {
  if (kind === "collection") return fieldsPointingAt(fields, slug);
  if (kind === "fieldGroup") return fieldsPlacing(fields, slug);
  return [];
}

/** How an entity is told apart from one of another kind with the same slug. */
function entityKey(kind: EntityKind, slug: string): string {
  return `${kind}:${slug}`;
}

/**
 * The fields among `owners` that name the entity of `kind` called `slug`,
 * leaving out entities deleted with it.
 */
function referencesAmong(
  owners: readonly FieldOwner[],
  kind: EntityKind,
  slug: string,
  goingToo: ReadonlySet<string>
): FieldReference[] {
  const references: FieldReference[] = [];
  for (const { entityType, entitySlug, fields } of owners) {
    if (goingToo.has(entityKey(entityType, entitySlug))) continue;
    for (const fieldPath of fieldsNaming(fields, kind, slug)) {
      references.push({ entityType, entitySlug, fieldPath });
    }
  }
  return references;
}

/** What could not be read, in the words a refusal uses. */
type UnreadableRecord = "fields" | "foreignKeys" | "liveKeys" | "elements";

const UNREADABLE_WORDS: Record<UnreadableRecord, string> = {
  fields: "the fields of collections, Singles and field groups",
  foreignKeys: "the foreign keys plugins and the app declare",
  liveKeys: "the foreign keys the database holds into its tables",
  elements:
    "the record of columns, indexes, foreign keys and checks other owners added to its tables",
};

/** A read's answer, or what failed. */
type Read<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function attempt<T>(read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * What a log line calls the entities a refusal is about: their kind when they
 * share one, so each kind's refusals can be told apart in the log.
 */
function logSubject(kinds: readonly EntityKind[]): string {
  const distinct = new Set(kinds);
  if (distinct.size !== 1) return "entity";
  const [kind] = distinct;
  return kind === "fieldGroup" ? "field-group" : kind;
}

/**
 * The refusal for a delete whose dependents could not all be read.
 *
 * Service unavailable rather than a conflict: nothing is known to depend on
 * the entities, and the delete can succeed once the read does.
 */
function unreadableRefusal(
  slugs: readonly string[],
  failed: ReadonlyMap<UnreadableRecord, unknown>,
  kinds: readonly EntityKind[] = ["collection"]
): NextlyError {
  const what = [...failed.keys()].map(key => UNREADABLE_WORDS[key]);
  const subject =
    slugs.length === 1
      ? `"${slugs[0]}" was not deleted`
      : `Nothing was deleted`;
  const first = [...failed.values()][0];
  return NextlyError.serviceUnavailable({
    publicMessage: `${subject}, because ${joinWords(what)} could not be read, so whether anything depends on ${slugs.length === 1 ? "it" : "them"} is unknown. Nothing was removed. Fix the cause in the server log and try again.`,
    ...(first instanceof Error ? { cause: first } : {}),
    logContext: {
      reason: `${logSubject(kinds)}-dependents-unreadable`,
      slugs: [...slugs],
      unreadable: [...failed.keys()],
      errors: [...failed.values()].map(error =>
        error instanceof Error ? error.message : String(error)
      ),
    },
  });
}

/**
 * The refusal for a delete of a collection or Single whose own stored fields
 * are not a list: its junction tables, and so what could depend on them,
 * cannot be named. The same refusal as any unreadable fields.
 *
 * @param slugs every entity the operation was deleting
 * @param slug the one whose stored fields are not a list
 * @param kind what it is, for the log; a collection unless said
 */
export function unreadableFieldsRefusal(
  slugs: readonly string[],
  slug: string,
  kind: EntityKind = "collection"
): NextlyError {
  return unreadableRefusal(
    slugs,
    new Map([
      ["fields", new Error(`The stored fields of "${slug}" are not a list.`)],
    ]),
    slugs.map(() => kind)
  );
}

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** An entity's kind, a collection unless it says otherwise. */
function kindOf(entity: EntityToDelete): EntityKind {
  return entity.kind ?? "collection";
}

/**
 * The entities of an operation whose fields go with it: every Single and
 * field group in it, and its collections, or the collections the caller names.
 */
function fieldsGoingWith(
  entities: readonly EntityToDelete[],
  options: DependentsOptions
): Set<string> {
  const goingToo = new Set<string>();
  for (const entity of entities) {
    if (kindOf(entity) !== "collection" || options.fieldsGoWith === undefined) {
      goingToo.add(entityKey(kindOf(entity), entity.slug));
    }
  }
  for (const slug of options.fieldsGoWith ?? []) {
    goingToo.add(entityKey("collection", slug));
  }
  return goingToo;
}

/**
 * Everything that depends on each entity, for those deleted together.
 *
 * Only entities something depends on are listed, in the order given.
 * Throws the fail-closed refusal when any of the three records cannot be read.
 *
 * @param entities the collections, Singles and field groups being deleted, all in one operation
 * @param sources where the dependents are read from
 * @param options whose fields go with the set
 */
export async function findEntityDependents(
  entities: readonly EntityToDelete[],
  sources: DependentsSources,
  options: DependentsOptions = {}
): Promise<Map<string, EntityDependents>> {
  const found = new Map<string, EntityDependents>();
  if (entities.length === 0) return found;

  const records = await readDependentRecords(entities, sources);
  // Only those outside the operation count: an entity's own tables, and the
  // tables and fields of entities deleted with it, go together.
  const goingToo = fieldsGoingWith(entities, options);

  for (const entity of entities) {
    const own = new Set(entity.tables);
    const kind = kindOf(entity);
    const dependents: EntityDependents = {
      kind,
      fields:
        entity.fieldSlug === null
          ? []
          : referencesAmong(
              records.owners,
              kind,
              entity.fieldSlug ?? entity.slug,
              goingToo
            ),
      foreignKeys: records.keys.filter(key => own.has(key.referencesTable)),
      retainedKeys:
        kind === "collection"
          ? []
          : retainedKeysInto(own, records, new Set(records.tables)),
      elements: records.elements.filter(element => own.has(element.table)),
    };
    if (hasAny(dependents)) found.set(entity.slug, dependents);
  }
  return found;
}

/**
 * The keys the database holds into `own` from outside the operation that no
 * declared key accounts for. A key is told by the table it is on and the
 * table it points at, since the catalog does not name every key.
 */
function retainedKeysInto(
  own: ReadonlySet<string>,
  records: DependentRecords,
  goingTables: ReadonlySet<string>
): LiveKeyInto[] {
  return records.liveKeys.filter(
    key =>
      own.has(key.referencesTable) &&
      !goingTables.has(key.table) &&
      !records.keys.some(
        declared =>
          declared.table === key.table &&
          declared.referencesTable === key.referencesTable
      )
  );
}

function hasAny(dependents: EntityDependents): boolean {
  return (
    dependents.fields.length > 0 ||
    dependents.foreignKeys.length > 0 ||
    dependents.retainedKeys.length > 0 ||
    dependents.elements.length > 0
  );
}

/** Every record a set of deletes is judged against, all read. */
interface DependentRecords {
  /** Every table the set drops. */
  tables: readonly string[];
  owners: readonly FieldOwner[];
  /** Declared keys into any of the set's tables, from outside them. */
  keys: readonly ForeignKeyInto[];
  /** Keys the database holds into the set's Singles' and field groups' tables. */
  liveKeys: readonly LiveKeyInto[];
  /** Other owners' elements on any of the set's tables, once each. */
  elements: readonly ElementOnTable[];
}

/**
 * Read the three records, or throw the fail-closed refusal naming each that
 * could not be read. Every read is attempted, so the refusal names them all
 * rather than the first.
 */
async function readDependentRecords(
  entities: readonly EntityToDelete[],
  sources: DependentsSources
): Promise<DependentRecords> {
  const allTables = entities.flatMap(entity => entity.tables);
  // Collections are left out: a Builder relationship holds a real key into
  // its target collection's table, which the relationship's field answers for.
  const liveTables = entities
    .filter(entity => kindOf(entity) !== "collection")
    .flatMap(entity => entity.tables);
  const [owners, schema, recorded, live] = await Promise.all([
    attempt(() => sources.fieldOwners()),
    attempt(() => sources.extensionSchema()),
    attempt(() => sources.recordedElements(allTables)),
    attempt(async () =>
      liveTables.length === 0 || sources.liveKeysInto === undefined
        ? []
        : sources.liveKeysInto(liveTables)
    ),
  ]);
  // The compiled schema's elements are read only once the schema is: a
  // schema that could not be read leaves its elements unread too.
  const compiled: Read<ElementOnTable[]> = schema.ok
    ? await attempt(async () =>
        schema.value === null ? [] : elementsAddedTo(schema.value, allTables)
      )
    : { ok: false, error: schema.error };

  const failed = failedReads({
    fields: owners,
    foreignKeys: schema,
    liveKeys: live,
    // The compiled schema's elements and the recorded rows are one record.
    elements: compiled.ok ? recorded : compiled,
  });
  if (failed.size > 0) {
    throw unreadableRefusal(
      entities.map(entity => entity.slug),
      failed,
      entities.map(kindOf)
    );
  }

  const extension = valueOf(schema);
  return {
    tables: allTables,
    owners: valueOf(owners),
    keys:
      extension === null ? [] : foreignKeysInto(extension, new Set(allTables)),
    liveKeys: valueOf(live),
    elements: distinctElements([...valueOf(compiled), ...valueOf(recorded)]),
  };
}

/** Each record whose read failed, with why, in the order a refusal names them. */
function failedReads(
  reads: Record<UnreadableRecord, Read<unknown>>
): Map<UnreadableRecord, unknown> {
  const failed = new Map<UnreadableRecord, unknown>();
  for (const key of Object.keys(UNREADABLE_WORDS) as UnreadableRecord[]) {
    const read = reads[key];
    if (!read.ok) failed.set(key, read.error);
  }
  return failed;
}

/** A read's value, once every read has been seen to succeed. */
function valueOf<T>(read: Read<T>): T {
  if (!read.ok) throw read.error;
  return read.value;
}

/** How a field reference reads in a message a person acts on. */
function describeFieldReference(reference: FieldReference): string {
  const path = `${reference.entitySlug}.${reference.fieldPath}`;
  if (reference.entityType === "single") return `the Single ${path}`;
  if (reference.entityType === "fieldGroup") return `the field group ${path}`;
  return path;
}

function describeRetainedKey(key: LiveKeyInto): string {
  const owner =
    key.owner === null
      ? "an owner nothing records"
      : `${describeOwner(key.owner)}, which no longer declares it`;
  return `a key on "${key.table}" (${owner})`;
}

function describeForeignKey(key: ForeignKeyInto): string {
  return `"${key.name}" on "${key.table}" (${describeOwner(key.owner)})`;
}

function describeElement(element: ElementOnTable): string {
  return `the ${ELEMENT_NOUNS[element.kind]} "${element.name}" on "${element.table}" (${describeOwner(element.owner)})`;
}

/** What the fields that name an entity of each kind do to it, as a refusal says. */
const FIELDS_THAT: Record<EntityKind, string> = {
  collection: "Fields that point at it",
  fieldGroup: "Fields that place it",
  // No field names a Single, so a Single's refusal never lists any.
  single: "Fields that name it",
};

/** One entity's dependents, as sentences. */
function describeDependents(dependents: EntityDependents): string {
  const parts: string[] = [];
  if (dependents.fields.length > 0) {
    parts.push(
      `${FIELDS_THAT[dependents.kind]}: ${dependents.fields.map(describeFieldReference).join(", ")}.`
    );
  }
  if (dependents.foreignKeys.length > 0 || dependents.retainedKeys.length > 0) {
    parts.push(
      `Foreign keys that point at its tables: ${[
        ...dependents.foreignKeys.map(describeForeignKey),
        ...dependents.retainedKeys.map(describeRetainedKey),
      ].join(", ")}.`
    );
  }
  if (dependents.elements.length > 0) {
    parts.push(
      `What other owners added to its tables: ${dependents.elements.map(describeElement).join(", ")}.`
    );
  }
  return parts.join(" ");
}

/**
 * What to do about fields that name the entities: point a relationship at
 * another collection, or place another field group, whichever kinds are named.
 */
function fieldsStep(kinds: ReadonlySet<EntityKind>): string {
  const instead: string[] = [];
  if (kinds.has("collection")) instead.push("point them at another collection");
  if (kinds.has("fieldGroup"))
    instead.push("have them place another field group");
  return `remove those fields, or ${instead.join(", or ")}`;
}

/** What to do about the kinds of dependent found. */
function howToProceed(found: ReadonlyMap<string, EntityDependents>): string {
  const all = [...found.values()];
  const steps: string[] = [];
  const named = new Set(
    all
      .filter(dependents => dependents.fields.length > 0)
      .map(dependents => dependents.kind)
  );
  if (named.size > 0) {
    steps.push(fieldsStep(named));
  }
  if (
    all.some(
      dependents =>
        dependents.foreignKeys.length > 0 || dependents.elements.length > 0
    )
  ) {
    steps.push(
      "have each owner named remove its foreign keys, columns, indexes and checks (a plugin's go when the plugin stops declaring them or is uninstalled)"
    );
  }
  if (all.some(dependents => dependents.retainedKeys.length > 0)) {
    steps.push(
      "remove the keys no configuration declares any more, by running the migration that drops them or by hand"
    );
  }
  const first = steps.join(", and ");
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * The refusal for deleting entities that something still depends on.
 *
 * @param found each entity that cannot be deleted, with what depends on it
 * @param slugs every entity the operation was deleting, in order
 * @param kinds the kind of each, in the same order
 */
function dependentsRefusal(
  found: ReadonlyMap<string, EntityDependents>,
  slugs: readonly string[],
  kinds: readonly EntityKind[]
): NextlyError {
  const message =
    slugs.length === 1 && found.size === 1
      ? `"${slugs[0]}" cannot be deleted while other schema depends on it. ${describeDependents([...found.values()][0])} ${howToProceed(found)}, then delete "${slugs[0]}".`
      : `Nothing was deleted, because other schema depends on ${joinWords([...found.keys()].map(slug => `"${slug}"`))}. ${[
          ...found,
        ]
          .map(
            ([slug, dependents]) =>
              `"${slug}": ${describeDependents(dependents)}`
          )
          .join(" ")} ${howToProceed(found)}, then try again.`;
  return NextlyError.conflict({
    reason: "state",
    message,
    logContext: {
      reason: `${logSubject(kinds)}-has-dependents`,
      slugs: [...slugs],
      dependents: Object.fromEntries(found),
    },
  });
}

/**
 * Refuse, before anything is removed, to delete collections, Singles or
 * field groups something still depends on, or whose dependents cannot be read.
 *
 * @param entities the entities being deleted, all in one operation
 * @param sources where the dependents are read from
 */
export async function assertNothingDependsOn(
  entities: readonly EntityToDelete[],
  sources: DependentsSources,
  options: DependentsOptions = {}
): Promise<void> {
  const found = await findEntityDependents(entities, sources, options);
  if (found.size > 0) {
    throw dependentsRefusal(
      found,
      entities.map(entity => entity.slug),
      entities.map(kindOf)
    );
  }
}

// ---------------------------------------------------------------------------
// Reading the dependents from a database
// ---------------------------------------------------------------------------

/** What reading the registries needs from an adapter. */
export interface DependentsAdapter extends StorageNameAdapter {
  select<T = unknown>(
    table: string,
    options?: { columns?: string[] }
  ): Promise<T[]>;
}

interface RegistryRow {
  readonly slug: unknown;
  readonly fields: unknown;
}

/** A registry's rows, or none when the registry does not exist yet. */
async function readRegistry(
  adapter: DependentsAdapter,
  table: string
): Promise<RegistryRow[]> {
  try {
    return await adapter.select<RegistryRow>(table, {
      columns: ["slug", "fields"],
    });
  } catch (error) {
    if (isMissingTable(error, adapter.dialect)) return [];
    throw error;
  }
}

/** A row's parsed field list, refusing one that does not parse into a list. */
function fieldListOf(row: RegistryRow, entityType: EntityKind): unknown[] {
  if (row.fields === null || row.fields === undefined) return [];
  const parsed = parseJsonIfString(row.fields);
  if (Array.isArray(parsed)) return parsed;
  throw NextlyError.internal({
    logContext: {
      reason: "registry-fields-unreadable",
      entityType,
      entitySlug: String(row.slug),
    },
  });
}

/** Options for {@link databaseDependentsSources}. */
export interface DatabaseSourcesOptions {
  /** Resolves the field-group registry's name. The real resolver unless a test replaces it. */
  readonly fieldGroupRegistryName?: (
    adapter: StorageNameAdapter
  ) => Promise<string>;
}

/**
 * Every entity that can hold a field, read from the collection, Single and
 * field-group registries, under whichever name the database gives the last.
 * Code-first entities are rows in the same registries, so they are read too.
 */
export async function readFieldOwners(
  adapter: DependentsAdapter,
  options: DatabaseSourcesOptions = {}
): Promise<FieldOwner[]> {
  const fieldGroupRegistry = await (
    options.fieldGroupRegistryName ?? resolveFieldGroupRegistryName
  )(adapter);
  const registries: [EntityKind, string][] = [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
    ["fieldGroup", fieldGroupRegistry],
  ];
  const owners: FieldOwner[] = [];
  for (const [entityType, table] of registries) {
    for (const row of await readRegistry(adapter, table)) {
      owners.push({
        entityType,
        entitySlug: String(row.slug),
        fields: fieldListOf(row, entityType),
      });
    }
  }
  return owners;
}

/**
 * The sources a delete reads from a database: the registries for the fields,
 * `nextly_schema_owners` for the recorded elements, and the extension schema
 * the caller has, which a booted process publishes and a command compiles.
 *
 * @param adapter the database the registries and the owner record live in
 * @param extensionSchema the compiled extension schema, or `null` when nothing declares one
 */
export function databaseDependentsSources(
  adapter: DependentsAdapter,
  extensionSchema: () => Promise<ExtensionSchemaRecord | null>,
  options: DatabaseSourcesOptions = {}
): DependentsSources {
  return {
    fieldOwners: () => readFieldOwners(adapter, options),
    extensionSchema,
    recordedElements: tables => readRecordedElementsOn(adapter, tables),
    liveKeysInto: tables => readLiveKeysInto(adapter, tables),
  };
}
