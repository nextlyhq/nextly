/**
 * Why an entry's delete was refused by the database, said plainly.
 *
 * A relationship made in the Schema Builder keeps a foreign key to its target. A required one
 * refuses the delete of an entry it still points at (an optional one empties itself instead), and
 * the database's own refusal names a constraint, if anything. Read after the delete's transaction
 * has rolled back, so nothing about the entry has changed: which keys still point at the entry's
 * table and refuse a delete, how many rows of each point at this entry, and the collection and
 * field each row belongs to. The message names them, so an editor knows what to change first.
 *
 * @module domains/collections/services/entry-still-referenced
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { querySqlRows } from "../../schema/pipeline/classifier/count-helpers";
import { readReferencingKeys } from "../../schema/pipeline/live-table-facts";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";

/** What still points at an entry through one key: whose field, and how many of its entries. */
export interface EntryReferrer {
  /** The referring collection's name, singular or plural as `count` reads. */
  collection: string;
  /** The referring field's label, else its name. */
  field: string;
  count: number;
}

/** A key that refuses a delete of the rows it points at: its referencing table and column. */
interface RefusingKey {
  table: string;
  column: string;
}

type Registry = Pick<DrizzleAdapter, "select" | "getDrizzle" | "dialect">;

/** The single-column keys referencing `table` whose delete action refuses the delete. */
async function refusingKeys(
  adapter: Registry,
  dialect: SupportedDialect,
  table: string
): Promise<RefusingKey[]> {
  const db = adapter.getDrizzle();
  if (dialect === "sqlite") {
    // One join over `sqlite_master` reads every table's outgoing keys (as `readReferencingTables`
    // does); a key of several columns has a row per column, so only one-column keys are kept.
    const rows = await querySqlRows<{
      child: string;
      key_id: number;
      column_name: string;
      on_delete: string;
    }>(
      db,
      dialect,
      sql`SELECT m.name AS child, fk.id AS key_id, fk."from" AS column_name,
                 fk.on_delete AS on_delete
          FROM sqlite_master AS m
          JOIN pragma_foreign_key_list(m.name) AS fk
          WHERE m.type = 'table' AND fk."table" = ${table}`
    );
    const byKey = new Map<string, typeof rows>();
    for (const row of rows) {
      const id = `${row.child}\u0000${row.key_id}`;
      byKey.set(id, [...(byKey.get(id) ?? []), row]);
    }
    return [...byKey.values()].flatMap(parts =>
      parts.length === 1 && refuses(parts[0].on_delete)
        ? [{ table: parts[0].child, column: parts[0].column_name }]
        : []
    );
  }
  const keys = await readReferencingKeys(db, dialect, { table });
  return keys.flatMap(key =>
    key.onDelete === "none" && key.columns.length === 1
      ? [{ table: key.child, column: key.columns[0] }]
      : []
  );
}

/** Whether a SQLite `on_delete` spelling leaves the referencing rows alone, and so refuses. */
function refuses(action: string): boolean {
  const upper = action.toUpperCase();
  return upper === "RESTRICT" || upper === "NO ACTION";
}

/** How many rows of `key`'s table point at `entryId`. */
async function countPointing(
  adapter: Registry,
  dialect: SupportedDialect,
  key: RefusingKey,
  entryId: string
): Promise<number> {
  const [row] = await querySqlRows<{ n: number | string }>(
    adapter.getDrizzle(),
    dialect,
    sql`SELECT COUNT(*) AS n FROM ${sql.identifier(key.table)}
        WHERE ${sql.identifier(key.column)} = ${entryId}`
  );
  return Number(row?.n ?? 0);
}

/** A stored JSON column, read whichever way the dialect hands it back. */
function parsed<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return (value ?? undefined) as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * What still points at `entryId` in `table` and refuses its delete: each referring collection's
 * field, with how many of its entries hold this one. A key on a table that is not a collection is
 * left out, since its rows are nobody's to change by hand.
 */
export async function referrersHolding(
  adapter: Registry,
  dialect: SupportedDialect,
  table: string,
  entryId: string
): Promise<EntryReferrer[]> {
  const keys = await refusingKeys(adapter, dialect, table);
  if (keys.length === 0) return [];
  const collections = await adapter.select<{
    tableName: string;
    labels: unknown;
    fields: unknown;
    slug: string;
  }>("dynamic_collections", {
    columns: ["slug", "tableName", "labels", "fields"],
  });
  const byTable = new Map(collections.map(c => [c.tableName, c]));
  const referrers: EntryReferrer[] = [];
  for (const key of keys) {
    const collection = byTable.get(key.table);
    if (collection === undefined) continue;
    const count = await countPointing(adapter, dialect, key, entryId);
    if (count === 0) continue;
    const labels = parsed<{ singular?: string; plural?: string }>(
      collection.labels
    );
    const fields =
      parsed<Array<{ name: string; label?: string }>>(collection.fields) ?? [];
    const field = fields.find(f => toSnakeCase(f.name) === key.column);
    referrers.push({
      collection:
        (count === 1 ? labels?.singular : labels?.plural) ?? collection.slug,
      field: field?.label ?? field?.name ?? key.column,
      count,
    });
  }
  return referrers;
}

/**
 * The refusal of an entry's delete that relationships still point at, naming each: for example
 * `This entry is still used by 12 Posts in "Author". Change or delete those first.`
 */
export function entryStillReferenced(
  referrers: readonly EntryReferrer[],
  logContext: Record<string, unknown>
): NextlyError {
  const each = referrers.map(r => `${r.count} ${r.collection} in "${r.field}"`);
  // "a", "a and b", "a, b and c".
  const uses =
    each.length <= 1
      ? (each[0] ?? "")
      : `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}`;
  return NextlyError.conflict({
    reason: "state",
    message: `This entry is still used by ${uses}. Change or delete those first.`,
    logContext: { ...logContext, reason: "entry-still-referenced" },
  });
}
