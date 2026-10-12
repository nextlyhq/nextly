/**
 * The fields that still point at a collection, and the refusal that keeps it from being deleted
 * while they do.
 *
 * Deleting a collection another collection's relationship field targets does something different
 * on each database: PostgreSQL drops the table with `CASCADE` and silently strips the other
 * table's foreign key, MySQL refuses partway through, and SQLite leaves the other side's links
 * pointing at rows that no longer exist. The rule is the same everywhere: refuse, and name every
 * field that has to go or be pointed elsewhere first.
 *
 * Every registry that can hold a field is read: collections, Singles and Field Groups, under
 * whichever name the database gives the Field Group registry. Code-first entities are rows in the
 * same registries, so they are covered too. Relationship and upload fields count, a single target
 * or one of several, at any depth inside repeaters and groups. A collection's references to itself
 * go with it and are not dependents, and neither are those of collections deleted with it.
 *
 * It fails closed. A registry that does not exist yet has nothing in it, but any other failure to
 * read one, or a stored field list that does not parse, stops the delete: a guard against losing
 * data that answers "nothing points here" about a registry it could not read has not checked.
 *
 * @module domains/collections/services/inbound-references
 */

import { typeHasNestedFields } from "../../../collections/fields/guards";
import { NextlyError } from "../../../errors/nextly-error";
import { isMissingTable } from "../../field-groups/migration/session";
import {
  resolveFieldGroupRegistryName,
  type StorageNameAdapter,
} from "../../field-groups/storage/resolve-storage-names";
import { parseJsonIfString } from "../../singles/services/single-utils";

/** The kind of entity a field that points at a collection belongs to. */
export type ReferencingEntityType = "collection" | "single" | "fieldGroup";

/** One field that points at a collection. */
export interface InboundReference {
  readonly entityType: ReferencingEntityType;
  readonly entitySlug: string;
  /** The field's path from its entity's top level, dotted through repeaters and groups. */
  readonly fieldPath: string;
}

/** What reading the registries needs from an adapter. */
export interface InboundReferenceAdapter extends StorageNameAdapter {
  select<T = unknown>(
    table: string,
    options?: { columns?: string[] }
  ): Promise<T[]>;
}

/** How the registries are read. */
export interface RegistryReadOptions {
  /** Resolves the Field Group registry's name. The real resolver unless a test replaces it. */
  readonly fieldGroupRegistryName?: (
    adapter: StorageNameAdapter
  ) => Promise<string>;
}

/** Options for {@link findInboundReferences} and {@link assertNothingPointsAt}. */
export interface InboundReferenceOptions extends RegistryReadOptions {
  /**
   * Slugs of collections deleted in the same operation, whose fields are not dependents
   * because they go too.
   */
  readonly deletedTogether?: readonly string[];
}

/** Field types whose `relationTo` names the collection a value points at. */
const REFERENCING_FIELD_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "upload",
]);

/** The collections a `relationTo` names, whether one or several. */
function targetsOf(relationTo: unknown): string[] {
  if (typeof relationTo === "string") return [relationTo];
  if (!Array.isArray(relationTo)) return [];
  return relationTo.filter(
    (target): target is string => typeof target === "string"
  );
}

/**
 * The paths of every field in a field list that points at `slug`, at any depth.
 *
 * @param fields a stored field list, as parsed from a registry row
 * @param slug the collection being deleted
 * @param parentPath the path of the container these fields sit in
 */
export function fieldsPointingAt(
  fields: unknown,
  slug: string,
  parentPath = ""
): string[] {
  if (!Array.isArray(fields)) return [];
  const paths: string[] = [];
  for (const field of fields) {
    if (field === null || typeof field !== "object") continue;
    const {
      name,
      type,
      relationTo,
      fields: children,
    } = field as Record<string, unknown>;
    if (typeof name !== "string" || name === "" || typeof type !== "string") {
      continue;
    }
    const path = parentPath === "" ? name : `${parentPath}.${name}`;
    if (
      REFERENCING_FIELD_TYPES.has(type) &&
      targetsOf(relationTo).includes(slug)
    ) {
      paths.push(path);
    }
    if (typeHasNestedFields(type)) {
      paths.push(...fieldsPointingAt(children, slug, path));
    }
  }
  return paths;
}

interface RegistryRow {
  readonly slug: unknown;
  readonly fields: unknown;
}

/** An entity that can hold fields, with the field list it stores. */
interface FieldOwner {
  readonly entityType: ReferencingEntityType;
  readonly entitySlug: string;
  readonly fields: unknown[];
}

/** A registry's rows, or none when the registry does not exist yet. */
async function readRegistry(
  adapter: InboundReferenceAdapter,
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

/** Every entity that can hold a field, read once from each registry. */
async function readFieldOwners(
  adapter: InboundReferenceAdapter,
  options: RegistryReadOptions
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

/** The fields that point at `slug`, leaving out the collections deleted with it. */
function referencesAmong(
  owners: readonly FieldOwner[],
  slug: string,
  goingToo: ReadonlySet<string>
): InboundReference[] {
  const references: InboundReference[] = [];
  for (const { entityType, entitySlug, fields } of owners) {
    if (entityType === "collection" && goingToo.has(entitySlug)) continue;
    for (const fieldPath of fieldsPointingAt(fields, slug)) {
      references.push({ entityType, entitySlug, fieldPath });
    }
  }
  return references;
}

/**
 * Every field, in every registry, that points at the collection `slug`.
 *
 * @param adapter the database the registries live in
 * @param slug the collection being deleted
 * @param options collections deleted in the same operation, and a test's registry resolver
 */
export async function findInboundReferences(
  adapter: InboundReferenceAdapter,
  slug: string,
  options: InboundReferenceOptions = {}
): Promise<InboundReference[]> {
  const owners = await readFieldOwners(adapter, options);
  return referencesAmong(
    owners,
    slug,
    new Set([slug, ...(options.deletedTogether ?? [])])
  );
}

/**
 * For collections deleted together, the fields outside the set that point at each one.
 *
 * Only the collections something outside the set still points at are listed, in the order given.
 *
 * @param adapter the database the registries live in
 * @param slugs the collections being deleted
 * @param options a test's registry resolver
 */
export async function findReferencesIntoSet(
  adapter: InboundReferenceAdapter,
  slugs: readonly string[],
  options: RegistryReadOptions = {}
): Promise<Map<string, InboundReference[]>> {
  const blocked = new Map<string, InboundReference[]>();
  if (slugs.length === 0) return blocked;
  const owners = await readFieldOwners(adapter, options);
  const goingToo = new Set(slugs);
  for (const slug of slugs) {
    const references = referencesAmong(owners, slug, goingToo);
    if (references.length > 0) blocked.set(slug, references);
  }
  return blocked;
}

/** How a reference reads in a message a person acts on. */
export function describeReference(reference: InboundReference): string {
  const path = `${reference.entitySlug}.${reference.fieldPath}`;
  if (reference.entityType === "single") return `the Single ${path}`;
  if (reference.entityType === "fieldGroup") return `the Field Group ${path}`;
  return path;
}

/**
 * The refusal for deleting a collection that fields still point at.
 *
 * @param slug the collection that cannot be deleted
 * @param references every field that points at it
 */
export function referencedCollectionConflict(
  slug: string,
  references: readonly InboundReference[]
): NextlyError {
  const listed = references.map(describeReference).join(", ");
  return NextlyError.conflict({
    reason: "state",
    message: `"${slug}" cannot be deleted while other fields point at it: ${listed}. Remove those fields, or point them at another collection, then delete "${slug}".`,
    logContext: { reason: "collection-has-references", slug, references },
  });
}

/**
 * The refusal for deleting collections together while fields outside them point at some.
 *
 * @param blocked each collection that cannot be deleted, with the fields that point at it
 */
export function referencedCollectionsConflict(
  blocked: ReadonlyMap<string, readonly InboundReference[]>
): NextlyError {
  const listed = [...blocked]
    .map(
      ([slug, references]) =>
        `"${slug}" (${references.map(describeReference).join(", ")})`
    )
    .join("; ");
  return NextlyError.conflict({
    reason: "state",
    message: `Nothing was deleted, because other fields still point at ${listed}. Remove those fields, or point them at another collection, then try again.`,
    logContext: {
      reason: "collections-have-references",
      blocked: Object.fromEntries(blocked),
    },
  });
}

/**
 * Refuse to go on while any field points at the collection. Call before anything is torn down.
 *
 * @param adapter the database the registries live in
 * @param slug the collection being deleted
 * @param options collections deleted in the same operation
 */
export async function assertNothingPointsAt(
  adapter: InboundReferenceAdapter,
  slug: string,
  options: InboundReferenceOptions = {}
): Promise<void> {
  const references = await findInboundReferences(adapter, slug, options);
  if (references.length > 0) {
    throw referencedCollectionConflict(slug, references);
  }
}
