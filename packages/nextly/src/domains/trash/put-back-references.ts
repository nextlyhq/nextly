/**
 * The references a restore puts back, beside the entry's own rows: the links
 * it held, and what other entries held pointing at it. Each goes back only
 * where the entry at its other end is still there, and the restore says how
 * many it could not put back, rather than failing on one.
 *
 * And the one reference it clears: a relation column of the entry's own row
 * whose target has been deleted since. The database would have cleared it
 * (`set null`) had the entry not been in the trash, and putting the id back
 * would be refused by the relation's foreign key every time.
 *
 * @module domains/trash/put-back-references
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { missingSchemaObject } from "../../database/missing-column";
import type { KeptIncoming, KeptLinks } from "../../schemas/trash";
import { fieldsStoredOnRow } from "../schema/services/field-column-descriptor";

import type { CapturedField } from "./capture-entry";
import { singleRelationTarget } from "./capture-incoming";

/** What putting references back needs of the database. */
export type ReferencesDb = Pick<
  DrizzleAdapter,
  "tableExistsThrough" | "getCapabilities"
>;

/** The ids of `table` among `ids` that are there now. */
export async function idsPresent(
  tx: TransactionContext,
  table: string,
  ids: readonly string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await tx.select<{ id: unknown }>(table, {
      where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
      columns: ["id"],
    });
    return new Set(rows.map(row => String(row.id)));
  } catch (error) {
    // A table this process has not registered holds no row it could read.
    if (missingSchemaObject(error)?.object === "unregistered") return new Set();
    throw error;
  }
}

/** One junction row, written as the relationship service writes a link. */
async function insertLink(
  tx: TransactionContext,
  db: ReferencesDb,
  link: {
    table: string;
    sourceColumn: string;
    targetColumn: string;
    sourceId: string;
    targetId: string;
  }
): Promise<void> {
  const { dialect } = db.getCapabilities();
  const idColumn = sql.identifier("id");
  // SQLite keeps the junction's time as whole seconds; the others take a
  // date, as the relationship service binds it.
  const createdAt =
    dialect === "sqlite" ? Math.floor(Date.now() / 1000) : new Date();
  const conflict =
    dialect === "mysql"
      ? sql`ON DUPLICATE KEY UPDATE ${idColumn} = ${idColumn}`
      : sql`ON CONFLICT DO NOTHING`;
  await tx.runStatement(
    sql`INSERT INTO ${sql.identifier(link.table)} (${idColumn}, ${sql.identifier(link.sourceColumn)}, ${sql.identifier(link.targetColumn)}, ${sql.identifier("created_at")}) VALUES (${crypto.randomUUID()}, ${link.sourceId}, ${link.targetId}, ${createdAt}) ${conflict}`
  );
}

/**
 * Put back the links one many-to-many field of the entry held, to the
 * entries still there. Answers how many it could not.
 */
export async function putBackLinks(
  tx: TransactionContext,
  db: ReferencesDb,
  links: KeptLinks,
  entryId: string,
  targetTable: string | undefined
): Promise<number> {
  if (
    targetTable === undefined ||
    !(await db.tableExistsThrough(tx, links.table))
  ) {
    return links.targetIds.length;
  }
  const present = await idsPresent(tx, targetTable, links.targetIds);
  for (const targetId of links.targetIds) {
    if (!present.has(targetId)) continue;
    await insertLink(tx, db, {
      table: links.table,
      sourceColumn: links.sourceColumn,
      targetColumn: links.targetColumn,
      sourceId: entryId,
      targetId,
    });
  }
  return links.targetIds.length - present.size;
}

/**
 * Put back one kind of reference other entries held to the entry: their
 * junction rows, for those still there; and the entry's id into their
 * column, where it still holds nothing, so a later edit is never undone.
 * Answers how many it could not.
 */
async function putBackOneIncoming(
  tx: TransactionContext,
  db: ReferencesDb,
  incoming: KeptIncoming,
  entryId: string
): Promise<number> {
  if (incoming.kind === "column") {
    // Nothing to count: a row gone or changed since is left as it is.
    await tx.update(
      incoming.table,
      { [incoming.column]: entryId },
      {
        and: [
          { column: "id", op: "IN", value: incoming.ids },
          { column: incoming.column, op: "IS NULL" },
        ],
      }
    );
    return 0;
  }
  if (!(await db.tableExistsThrough(tx, incoming.table))) {
    return incoming.sourceIds.length;
  }
  const present = await idsPresent(
    tx,
    incoming.sourceTable,
    incoming.sourceIds
  );
  for (const sourceId of incoming.sourceIds) {
    if (!present.has(sourceId)) continue;
    await insertLink(tx, db, {
      table: incoming.table,
      sourceColumn: incoming.sourceColumn,
      targetColumn: incoming.targetColumn,
      sourceId,
      targetId: entryId,
    });
  }
  return incoming.sourceIds.length - present.size;
}

/** {@link putBackOneIncoming} for each; answers how many it could not. */
export async function putBackIncoming(
  tx: TransactionContext,
  db: ReferencesDb,
  incoming: readonly KeptIncoming[],
  entryId: string
): Promise<number> {
  let leftOut = 0;
  for (const each of incoming) {
    try {
      leftOut += await putBackOneIncoming(tx, db, each, entryId);
    } catch (error) {
      // A table this process has not registered: refused before any
      // statement, so the transaction is still usable, and nothing of it
      // could be put back.
      if (missingSchemaObject(error)?.object !== "unregistered") throw error;
      leftOut +=
        each.kind === "links" ? each.sourceIds.length : each.ids.length;
    }
  }
  return leftOut;
}

/** The collections the entry's own single relation columns point at. */
export function relationTargetsOf(
  fields: readonly CapturedField[]
): Map<string, string> {
  const targets = new Map<string, string>();
  for (const field of fieldsStoredOnRow(fields)) {
    const target = singleRelationTarget(field);
    if (target !== undefined && typeof field.name === "string") {
      targets.set(field.name, target);
    }
  }
  return targets;
}

/**
 * The entry's own relation columns whose target has been deleted since: the
 * fields to put back empty, as the database would have left them.
 */
export async function relationsGone(
  tx: TransactionContext,
  row: Record<string, unknown>,
  targets: ReadonlyMap<string, string>,
  targetTables: ReadonlyMap<string, string | undefined>
): Promise<string[]> {
  const gone: string[] = [];
  for (const [field, targetSlug] of targets) {
    // A single relation column holds one id, as text or a number.
    const raw = row[field];
    const value =
      typeof raw === "string" || typeof raw === "number" ? `${raw}` : "";
    if (value === "") continue;
    const table = targetTables.get(targetSlug);
    const present =
      table === undefined
        ? new Set<string>()
        : await idsPresent(tx, table, [value]);
    if (!present.has(value)) gone.push(field);
  }
  return gone;
}
