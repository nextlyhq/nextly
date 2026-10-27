/**
 * What depends on a collection, and the refusal that keeps it from being
 * deleted while anything does.
 *
 * Three things can depend on a collection, and deleting it breaks each:
 *
 * - **A field that points at it**: a relationship or upload of another
 *   collection, a Single or a field group, at any depth inside repeaters and
 *   groups. Deleting the collection leaves the field pointing at nothing, and
 *   each database does something different with the rows: PostgreSQL drops
 *   the table with `CASCADE` and strips the other table's foreign key, MySQL
 *   refuses partway through, SQLite leaves links to rows that are gone.
 * - **A foreign key that a plugin or the app declares** on a table of its own
 *   and points at one of the collection's tables.
 * - **Another owner's element on one of its tables**: a hidden column, an
 *   index, a foreign key or a check a plugin or the app added. Dropping the
 *   table takes it, with its values.
 *
 * The rule is the same for all three and on every database: refuse before
 * anything is removed, and name each dependent with what to do about it.
 *
 * It fails closed. A registry that does not exist yet has nothing in it, but
 * any other failure to read one, a stored field list that does not parse, or
 * a failure to read the declared foreign keys or the record of other owners'
 * elements stops the delete: a guard against losing data that answers
 * "nothing depends on it" about a record it could not read has not checked.
 *
 * Dependents deleted in the same operation do not count: a collection's
 * references to itself go with it, and so do those of collections deleted
 * with it.
 *
 * @module domains/collections/services/collection-dependents
 */

import { typeHasNestedFields } from "../../../collections/fields/guards";
import { NextlyError } from "../../../errors/nextly-error";
import { isMissingTable } from "../../field-groups/migration/session";
import {
  resolveFieldGroupRegistryName,
  type StorageNameAdapter,
} from "../../field-groups/storage/resolve-storage-names";
import {
  describeOwner,
  distinctElements,
  elementsAddedTo,
  foreignKeysInto,
  readRecordedElementsOn,
  type ElementOnTable,
  type ExtensionSchemaRecord,
  type ForeignKeyInto,
} from "../../schema/ownership/dependent-elements";
import { ELEMENT_NOUNS } from "../../schema/ownership/owner-registry";
import { parseJsonIfString } from "../../singles/services/single-utils";

/** The kind of entity a field that points at a collection belongs to. */
export type ReferencingEntityType = "collection" | "single" | "fieldGroup";

/** One field that points at a collection. */
export interface FieldReference {
  readonly entityType: ReferencingEntityType;
  readonly entitySlug: string;
  /** The field's path from its entity's top level, dotted through repeaters and groups. */
  readonly fieldPath: string;
}

/** An entity that can hold fields, with the field list it stores. */
export interface FieldOwner {
  readonly entityType: ReferencingEntityType;
  readonly entitySlug: string;
  readonly fields: readonly unknown[];
}

/** A collection about to be deleted, and every table it owns. */
export interface CollectionToDelete {
  readonly slug: string;
  /** Its own table, its translation table and its junction tables. */
  readonly tables: readonly string[];
}

/** How a set of deletes is judged. */
export interface DependentsOptions {
  /**
   * The collections whose fields go with the set, so they point at nothing
   * afterwards and are no reason to refuse. Every collection in the set
   * unless the caller knows better: a command that names a removed
   * collection only by what its table reads as passes the slugs it knows,
   * so a surviving collection of that name keeps its fields counted.
   */
  readonly fieldsGoWith?: readonly string[];
}

/** What depends on one collection. Empty lists mean nothing of that kind does. */
export interface CollectionDependents {
  readonly fields: readonly FieldReference[];
  readonly foreignKeys: readonly ForeignKeyInto[];
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
 * repeaters and groups, with the collections each points at. The one walk
 * every question about what a field list points at derives from.
 *
 * @param fields a stored field list, as parsed from a registry row
 * @param parentPath the path of the container these fields sit in
 */
export function referencingFields(
  fields: unknown,
  parentPath = ""
): ReferencingField[] {
  if (!Array.isArray(fields)) return [];
  const found: ReferencingField[] = [];
  for (const field of fields) {
    if (field === null || typeof field !== "object") continue;
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

/** The fields among `owners` that point at `slug`, leaving out collections deleted with it. */
function referencesAmong(
  owners: readonly FieldOwner[],
  slug: string,
  goingToo: ReadonlySet<string>
): FieldReference[] {
  const references: FieldReference[] = [];
  for (const { entityType, entitySlug, fields } of owners) {
    if (entityType === "collection" && goingToo.has(entitySlug)) continue;
    for (const fieldPath of fieldsPointingAt(fields, slug)) {
      references.push({ entityType, entitySlug, fieldPath });
    }
  }
  return references;
}

/** What could not be read, in the words a refusal uses. */
type UnreadableRecord = "fields" | "foreignKeys" | "elements";

const UNREADABLE_WORDS: Record<UnreadableRecord, string> = {
  fields: "the fields of collections, Singles and field groups",
  foreignKeys: "the foreign keys plugins and the app declare",
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
 * The refusal for a delete whose dependents could not all be read.
 *
 * Service unavailable rather than a conflict: nothing is known to depend on
 * the collections, and the delete can succeed once the read does.
 */
function unreadableRefusal(
  slugs: readonly string[],
  failed: ReadonlyMap<UnreadableRecord, unknown>
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
      reason: "collection-dependents-unreadable",
      slugs: [...slugs],
      unreadable: [...failed.keys()],
      errors: [...failed.values()].map(error =>
        error instanceof Error ? error.message : String(error)
      ),
    },
  });
}

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Everything that depends on each collection, for those deleted together.
 *
 * Only collections something depends on are listed, in the order given.
 * Throws the fail-closed refusal when any of the three records cannot be read.
 *
 * @param collections the collections being deleted, all in one operation
 * @param sources where the dependents are read from
 * @param options whose fields go with the set
 */
export async function findCollectionDependents(
  collections: readonly CollectionToDelete[],
  sources: DependentsSources,
  options: DependentsOptions = {}
): Promise<Map<string, CollectionDependents>> {
  const found = new Map<string, CollectionDependents>();
  if (collections.length === 0) return found;

  const records = await readDependentRecords(collections, sources);
  // Only those outside the operation count: a collection's own tables, and
  // the tables and fields of collections deleted with it, go together.
  const goingToo = new Set(
    options.fieldsGoWith ?? collections.map(collection => collection.slug)
  );

  for (const collection of collections) {
    const own = new Set(collection.tables);
    const dependents: CollectionDependents = {
      fields: referencesAmong(records.owners, collection.slug, goingToo),
      foreignKeys: records.keys.filter(key => own.has(key.referencesTable)),
      elements: records.elements.filter(element => own.has(element.table)),
    };
    if (hasAny(dependents)) found.set(collection.slug, dependents);
  }
  return found;
}

function hasAny(dependents: CollectionDependents): boolean {
  return (
    dependents.fields.length > 0 ||
    dependents.foreignKeys.length > 0 ||
    dependents.elements.length > 0
  );
}

/** Every record a set of deletes is judged against, all read. */
interface DependentRecords {
  owners: readonly FieldOwner[];
  /** Declared keys into any of the set's tables, from outside them. */
  keys: readonly ForeignKeyInto[];
  /** Other owners' elements on any of the set's tables, once each. */
  elements: readonly ElementOnTable[];
}

/**
 * Read the three records, or throw the fail-closed refusal naming each that
 * could not be read. Every read is attempted, so the refusal names them all
 * rather than the first.
 */
async function readDependentRecords(
  collections: readonly CollectionToDelete[],
  sources: DependentsSources
): Promise<DependentRecords> {
  const allTables = collections.flatMap(collection => collection.tables);
  const [owners, schema, recorded] = await Promise.all([
    attempt(() => sources.fieldOwners()),
    attempt(() => sources.extensionSchema()),
    attempt(() => sources.recordedElements(allTables)),
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
    // The compiled schema's elements and the recorded rows are one record.
    elements: compiled.ok ? recorded : compiled,
  });
  if (failed.size > 0) {
    throw unreadableRefusal(
      collections.map(collection => collection.slug),
      failed
    );
  }

  const extension = valueOf(schema);
  return {
    owners: valueOf(owners),
    keys:
      extension === null ? [] : foreignKeysInto(extension, new Set(allTables)),
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

function describeForeignKey(key: ForeignKeyInto): string {
  return `"${key.name}" on "${key.table}" (${describeOwner(key.owner)})`;
}

function describeElement(element: ElementOnTable): string {
  return `the ${ELEMENT_NOUNS[element.kind]} "${element.name}" on "${element.table}" (${describeOwner(element.owner)})`;
}

/** One collection's dependents, as sentences. */
function describeDependents(dependents: CollectionDependents): string {
  const parts: string[] = [];
  if (dependents.fields.length > 0) {
    parts.push(
      `Fields that point at it: ${dependents.fields.map(describeFieldReference).join(", ")}.`
    );
  }
  if (dependents.foreignKeys.length > 0) {
    parts.push(
      `Foreign keys that point at its tables: ${dependents.foreignKeys.map(describeForeignKey).join(", ")}.`
    );
  }
  if (dependents.elements.length > 0) {
    parts.push(
      `What other owners added to its tables: ${dependents.elements.map(describeElement).join(", ")}.`
    );
  }
  return parts.join(" ");
}

/** What to do about the kinds of dependent found. */
function howToProceed(
  found: ReadonlyMap<string, CollectionDependents>
): string {
  const all = [...found.values()];
  const steps: string[] = [];
  if (all.some(dependents => dependents.fields.length > 0)) {
    steps.push("remove those fields, or point them at another collection");
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
  const first = steps.join(", and ");
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * The refusal for deleting collections that something still depends on.
 *
 * @param found each collection that cannot be deleted, with what depends on it
 * @param slugs every collection the operation was deleting, in order
 */
function collectionDependentsRefusal(
  found: ReadonlyMap<string, CollectionDependents>,
  slugs: readonly string[]
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
      reason: "collection-has-dependents",
      slugs: [...slugs],
      dependents: Object.fromEntries(found),
    },
  });
}

/**
 * Refuse, before anything is removed, to delete collections something still
 * depends on, or whose dependents cannot be read.
 *
 * @param collections the collections being deleted, all in one operation
 * @param sources where the dependents are read from
 */
export async function assertNothingDependsOn(
  collections: readonly CollectionToDelete[],
  sources: DependentsSources,
  options: DependentsOptions = {}
): Promise<void> {
  const found = await findCollectionDependents(collections, sources, options);
  if (found.size > 0) {
    throw collectionDependentsRefusal(
      found,
      collections.map(collection => collection.slug)
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
function fieldListOf(
  row: RegistryRow,
  entityType: ReferencingEntityType
): unknown[] {
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
  const registries: [ReferencingEntityType, string][] = [
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
  };
}
