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

import type { KeptIncoming } from "../../schemas/trash";
import { usesJunctionTable } from "../schema/field-rules";
import {
  fieldsStoredOnRow,
  junctionLinkColumnsOf,
  junctionTableTo,
} from "../schema/services/field-column-descriptor";

import type { CapturedField } from "./capture-entry";

/** The collections registry, as every collection's own row records it. */
const REGISTRY_TABLE = "dynamic_collections";

/** One collection as the registry stores it. */
interface RegistryRow {
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
  if (field.type !== "relationship" || usesJunctionTable(field))
    return undefined;
  const own = field as CapturedField & {
    relationTo?: unknown;
    hasMany?: unknown;
  };
  if (own.hasMany === true || optionOf(field, "hasMany") === true) {
    return undefined;
  }
  const target = own.relationTo ?? optionOf(field, "target");
  return typeof target === "string" && target !== "" ? target : undefined;
}

/** Every collection's slug, table and fields, read on the transaction. */
async function collectionsOn(tx: TransactionContext): Promise<RegistryRow[]> {
  return tx.select<RegistryRow>(REGISTRY_TABLE, {
    columns: ["slug", "tableName", "fields"],
  });
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
  };
}

/** The other entries of `source` whose column `name` holds the entry's id. */
async function incomingColumn(
  tx: TransactionContext,
  source: RegistryRow,
  name: string,
  entryId: string
): Promise<KeptIncoming | undefined> {
  const rows = await tx.select<{ id: unknown }>(source.tableName, {
    columns: ["id"],
    where: { and: [{ column: name, op: "=", value: entryId }] },
  });
  if (rows.length === 0) return undefined;
  return {
    kind: "column",
    table: source.tableName,
    column: name,
    ids: rows.map(row => String(row.id)),
  };
}

/** The savepoint a read of another collection runs under. */
const SAVEPOINT = "nextly_trash_incoming";

/**
 * `read`, under a savepoint where the database keeps one: another
 * collection's table that is not in step with its definition (not migrated
 * yet, say) fails its read, which on PostgreSQL would otherwise abort the
 * delete's whole transaction. A failed read keeps nothing of that collection
 * and the delete goes on, as it would have before the trash.
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
  } catch {
    await tx.rollbackToSavepoint(SAVEPOINT);
    await tx.releaseSavepoint(SAVEPOINT);
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
    return optionOf(field, "target") === input.collection &&
      source.tableName !== input.tableName
      ? "links"
      : undefined;
  }
  return singleRelationTarget(field) === input.collection
    ? "column"
    : undefined;
}

/**
 * What every other entry holds pointing at `entryId` of `collection`, whose
 * own table is `tableName`. The entry's own links are its own record's, so
 * its own collection's junctions to itself are left to them.
 */
export async function captureIncoming(
  tx: TransactionContext,
  input: {
    collection: string;
    tableName: string;
    entryId: string;
    tableExists: (table: string) => Promise<boolean>;
  }
): Promise<KeptIncoming[]> {
  const kept: KeptIncoming[] = [];
  for (const source of await collectionsOn(tx)) {
    // A collection whose table is not there yet holds nothing.
    if (!(await input.tableExists(source.tableName))) continue;
    for (const field of fieldsStoredOnRow(storedFields(source.fields))) {
      const name = field.name;
      if (typeof name !== "string") continue;
      const by = pointsBy(source, field, input);
      if (by === undefined) continue;
      const found = await tolerantly(tx, () =>
        by === "links"
          ? incomingLinks(
              tx,
              source,
              field,
              { slug: input.collection, entryId: input.entryId },
              input.tableExists
            )
          : incomingColumn(tx, source, name, input.entryId)
      );
      if (found !== undefined) kept.push(found);
    }
  }
  return kept;
}
