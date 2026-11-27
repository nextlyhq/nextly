/**
 * What other entries hold pointing at an entry being trashed, read on the
 * delete's transaction before the delete removes it: what the database then
 * removes or clears on its own, through the relations' foreign keys.
 *
 * - Each many-to-many field of another collection that targets this one
 *   keeps the entry in a junction; the database removes those rows with it.
 * - Each single relation column of another collection that targets this
 *   one holds its id; the database clears it (`set null`), or leaves it
 *   where the relation has no foreign key.
 *
 * A restore puts back the junction rows of the entries still there, and the
 * id into each column that still holds nothing (`putBackIncoming`), so a
 * person's later edit of the other entry is never undone. A relation set to
 * delete the other entries with it (`cascade`) removes them for good, as it
 * always has; nothing here brings them back.
 *
 * @module domains/trash/capture-incoming
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { missingSchemaObject } from "../../database/missing-column";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import type { IncomingSource, KeptIncoming } from "../../schemas/trash";
import { COMPANION_PARENT_COLUMN } from "../i18n/companion-columns";
import {
  relationHoldsReferenceList,
  usesJunctionTable,
} from "../schema/field-rules";
import {
  fieldsStoredOnRow,
  junctionLinkColumnsOf,
  junctionTableTo,
} from "../schema/services/field-column-descriptor";

import type { CapturedField } from "./capture-entry";

/**
 * The registries of the entities whose fields can point at an entry: every
 * collection's, and every Single's.
 */
const REGISTRIES = [
  { kind: "collection", table: "dynamic_collections" },
  { kind: "single", table: "dynamic_singles" },
] as const;

/** One entity as its registry stores it. */
interface RegistryRow {
  kind: "collection" | "single";
  slug: string;
  tableName: string;
  fields: unknown;
}

/** A registry row's stored fields, from either form a driver returns. */
function storedFields(value: unknown): CapturedField[] {
  const parsed: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as CapturedField[]) : [];
}

/** A field's option, where it has options. */
function optionOf(field: CapturedField, name: string): unknown {
  const options = field.options;
  return typeof options === "object" && options !== null
    ? (options as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The collection a single relation field points at, where it holds one id in
 * a column of its own: a many-to-many keeps a junction, and a field of many
 * or of several collections keeps a JSON value no foreign key reaches.
 */
export function singleRelationTarget(field: CapturedField): string | undefined {
  if (field.type !== "relationship" && field.type !== "upload")
    return undefined;
  const own = field as CapturedField & {
    relationTo?: unknown;
    hasMany?: unknown;
  };
  // A list of references (`hasMany`, or a many-to-many's junction) holds no
  // one id in a column, by the rule every road classifies relations by.
  if (
    relationHoldsReferenceList({
      type: field.type,
      hasMany: own.hasMany ?? optionOf(field, "hasMany"),
      options: field.options,
    })
  ) {
    return undefined;
  }
  // An upload names the media library unless it says otherwise. A target
  // that is a list (polymorphic) keeps a value no single table holds.
  const target =
    own.relationTo ??
    optionOf(field, "target") ??
    (field.type === "upload" ? "media" : undefined);
  return typeof target === "string" && target !== "" ? target : undefined;
}

/** Every collection's and Single's slug, table and fields, read on the transaction. */
async function entitiesOn(tx: TransactionContext): Promise<RegistryRow[]> {
  const entities: RegistryRow[] = [];
  for (const registry of REGISTRIES) {
    const rows = await tx.select<Omit<RegistryRow, "kind">>(registry.table, {
      columns: ["slug", "tableName", "fields"],
    });
    for (const row of rows) entities.push({ ...row, kind: registry.kind });
  }
  return entities;
}

/** Where a kept reference came from: the entity and its field. */
function sourceOf(source: RegistryRow, field: string): IncomingSource {
  return { kind: source.kind, slug: source.slug, field };
}

/** The junction rows from other entries of `source` to the entry. */
async function incomingLinks(
  tx: TransactionContext,
  source: RegistryRow,
  field: CapturedField,
  target: { slug: string; entryId: string },
  tableExists: (table: string) => Promise<boolean>
): Promise<KeptIncoming | undefined> {
  const table = junctionTableTo(source.tableName, target.slug, field);
  if (!(await tableExists(table))) return undefined;
  const { sourceColumn, targetColumn } = junctionLinkColumnsOf(
    source.tableName,
    target.slug
  );
  // Read as the relationship service reads a junction: it is not a
  // registered table.
  const rows = await tx.queryStatement<{ source_id: unknown }>(
    sql`SELECT ${sql.identifier(sourceColumn)} AS source_id FROM ${sql.identifier(table)} WHERE ${sql.identifier(targetColumn)} = ${target.entryId}`
  );
  if (rows.length === 0) return undefined;
  return {
    kind: "links",
    table,
    sourceColumn,
    targetColumn,
    sourceTable: source.tableName,
    sourceIds: rows.map(row => String(row.source_id)),
    source: sourceOf(source, String(field.name)),
  };
}

/** The rows of `source`'s own table whose column `name` holds the entry's id. */
async function incomingOwnRows(
  tx: TransactionContext,
  source: RegistryRow,
  name: string,
  entryId: string
): Promise<string[]> {
  // A built statement, as a junction is read: a column the table does not
  // have is then the database's own answer, which `tolerantly` knows.
  const rows = await tx.queryStatement<{ id: unknown }>(
    sql`SELECT ${sql.identifier("id")} AS id FROM ${sql.identifier(source.tableName)} WHERE ${sql.identifier(name)} = ${entryId}`
  );
  return rows.map(row => String(row.id));
}

/**
 * The rows per language of `source` whose column `name` holds the entry's
 * id: where a translated relation keeps its value. None where there is no
 * such table, or it has no such column.
 */
async function incomingLanguageRows(
  tx: TransactionContext,
  source: RegistryRow,
  name: string,
  entryId: string,
  tableExists: (table: string) => Promise<boolean>
): Promise<{ parent: string; locale: string }[]> {
  const companion = `${source.tableName}${STORAGE_FORMAT.companionSuffix}`;
  if (!(await tableExists(companion))) return [];
  const rows = await tx.queryStatement<{ parent: unknown; locale: unknown }>(
    sql`SELECT ${sql.identifier(COMPANION_PARENT_COLUMN)} AS parent, ${sql.identifier("_locale")} AS locale FROM ${sql.identifier(companion)} WHERE ${sql.identifier(name)} = ${entryId}`
  );
  return rows.map(row => ({
    parent: String(row.parent),
    locale: String(row.locale),
  }));
}

/** The savepoint a read of another collection runs under. */
const SAVEPOINT = "nextly_trash_incoming";

/**
 * `read`, under a savepoint where the database keeps one: another
 * collection's table that is not in step with its definition (a table or a
 * column not migrated yet) fails its read, which on PostgreSQL would
 * otherwise abort the delete's whole transaction. Such a read keeps nothing
 * of that collection and the delete goes on, as it would have before the
 * trash; any other failure is the delete's.
 */
async function tolerantly<T>(
  tx: TransactionContext,
  read: () => Promise<T | undefined>
): Promise<T | undefined> {
  if (
    tx.savepoint === undefined ||
    tx.rollbackToSavepoint === undefined ||
    tx.releaseSavepoint === undefined
  ) {
    return read();
  }
  await tx.savepoint(SAVEPOINT);
  try {
    const value = await read();
    await tx.releaseSavepoint(SAVEPOINT);
    return value;
  } catch (error) {
    await tx.rollbackToSavepoint(SAVEPOINT);
    await tx.releaseSavepoint(SAVEPOINT);
    // Only a table or column the database does not have is passed over;
    // any other failure fails the delete, rather than leave what other
    // entries held to it unkept without a word.
    if (missingSchemaObject(error) === undefined) throw error;
    return undefined;
  }
}

/**
 * How a field of another collection can point at the entry: through a
 * junction, through a column of its own, or not at all. The entry's own
 * collection's junctions to itself are the entry's own record's.
 */
function pointsBy(
  source: RegistryRow,
  field: CapturedField,
  input: { collection: string; tableName: string }
): "links" | "column" | undefined {
  if (usesJunctionTable(field)) {
    if (optionOf(field, "target") !== input.collection) return undefined;
    // A collection's junction to itself holds the entry on both sides; its
    // own side is the entry's own record's. Only where the two link columns
    // are one name (a table named as its slug) is there no other side.
    const { sourceColumn, targetColumn } = junctionLinkColumnsOf(
      source.tableName,
      input.collection
    );
    return source.tableName === input.tableName && sourceColumn === targetColumn
      ? undefined
      : "links";
  }
  return singleRelationTarget(field) === input.collection
    ? "column"
    : undefined;
}

/** What a capture of the references to one entry is given. */
interface IncomingInput {
  collection: string;
  tableName: string;
  entryId: string;
  tableExists: (table: string) => Promise<boolean>;
}

/** One field of another entity that can point at the entry, and how. */
interface PointingField {
  field: CapturedField;
  name: string;
  by: "links" | "column";
}

/** The fields of `source` that can point at the entry; none read yet. */
function pointingFieldsOf(
  source: RegistryRow,
  input: IncomingInput
): PointingField[] {
  return fieldsStoredOnRow(storedFields(source.fields)).flatMap(field => {
    const by =
      typeof field.name === "string"
        ? pointsBy(source, field, input)
        : undefined;
    return by === undefined ? [] : [{ field, name: String(field.name), by }];
  });
}

/**
 * The rows of `source` whose single relation column `name` holds the entry:
 * on the entity's own rows, or, translated, on its rows per language. Each
 * is read under its own savepoint, so the one that has no such column costs
 * the other nothing.
 */
async function incomingColumn(
  tx: TransactionContext,
  source: RegistryRow,
  name: string,
  input: IncomingInput
): Promise<KeptIncoming | undefined> {
  const ids =
    (await tolerantly(tx, () =>
      incomingOwnRows(tx, source, name, input.entryId)
    )) ?? [];
  const languageRows =
    (await tolerantly(tx, () =>
      incomingLanguageRows(tx, source, name, input.entryId, input.tableExists)
    )) ?? [];
  if (ids.length === 0 && languageRows.length === 0) return undefined;
  return {
    kind: "column",
    table: source.tableName,
    column: name,
    ids,
    ...(languageRows.length === 0 ? {} : { languageRows }),
    source: sourceOf(source, name),
  };
}

/** What one field of `source` holds pointing at the entry. */
function incomingThrough(
  tx: TransactionContext,
  source: RegistryRow,
  pointing: PointingField,
  input: IncomingInput
): Promise<KeptIncoming | undefined> {
  if (pointing.by === "column") {
    return incomingColumn(tx, source, pointing.name, input);
  }
  return tolerantly(tx, () =>
    incomingLinks(
      tx,
      source,
      pointing.field,
      { slug: input.collection, entryId: input.entryId },
      input.tableExists
    )
  );
}

/**
 * What every other entry holds pointing at `entryId` of `collection`, whose
 * own table is `tableName`.
 */
export async function captureIncoming(
  tx: TransactionContext,
  input: IncomingInput
): Promise<KeptIncoming[]> {
  const kept: KeptIncoming[] = [];
  for (const source of await entitiesOn(tx)) {
    // Only the fields that can point at the entry are read, and only an
    // entity with one is asked whether its table is there: a delete costs a
    // query per relation to this collection, not one per collection.
    const pointing = pointingFieldsOf(source, input);
    if (pointing.length === 0) continue;
    // An entity whose table is not there yet holds nothing.
    if (!(await input.tableExists(source.tableName))) continue;
    for (const each of pointing) {
      const found = await incomingThrough(tx, source, each, input);
      if (found !== undefined) kept.push(found);
    }
  }
  return kept;
}
