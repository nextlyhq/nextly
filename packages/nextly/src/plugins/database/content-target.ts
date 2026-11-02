/**
 * Whose cached reads a write to an entity table changed.
 *
 * `ctx.db.contributed` writes a plugin's own columns on a collection's,
 * Single's or field group's table without going through that entity's content
 * service, so nothing else expires the reads that show the row. A field
 * group's row is shown inside its parent document: it names that parent in its
 * `_parent_table` and `_parent_id` columns, and the walk follows them, a field
 * group inside a field group included, up to the collection entry or Single
 * whose pages carry it.
 *
 * @module plugins/database/content-target
 */
import type { AnyColumn, SQL, Table } from "drizzle-orm";
import { eq, getColumns } from "drizzle-orm";

import type { EntityOwner } from "../../domains/schema/extension/build-extension-schema";
import { getNextlyLogger } from "../../observability/logger";
import { STORAGE_FORMAT } from "../../schemas/storage-format";

/** A collection entry or a Single, whose cached reads a write changed. */
export type ContentTarget =
  | { kind: "collection"; slug: string; id: string }
  | { kind: "single"; slug: string };

/**
 * How many field groups a walk climbs before it stops. Each step is one read,
 * so a parent chain that loops (a row naming itself, or two naming each
 * other) ends here rather than reading for ever.
 */
export const MAX_COMPONENT_DEPTH = 8;

export interface ContentTargetDeps {
  /** The collection, Single or field group a table stores, by SQL name. */
  contentEntity: (tableName: string) => EntityOwner | undefined;
  /** The runtime Drizzle table of an entity table, by SQL name. */
  entityTable: (tableName: string) => unknown;
  /** The handle the write ran on, so the parent read sees it. */
  db: () => unknown;
}

interface SelectOne {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: SQL) => {
        limit: (count: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/**
 * The entry or Single a write to row `id` of `tableName` changed, or
 * undefined when the table stores neither (a core table, an extension table,
 * a Builder-made entity the compiled schema does not know) or a field group's
 * parent cannot be found.
 */
export async function contentTarget(
  tableName: string,
  id: string | number,
  deps: ContentTargetDeps
): Promise<ContentTarget | undefined> {
  let table = tableName;
  let rowId = String(id);
  // One bound, the `break` below: each pass reads one parent at most.
  for (let climbed = 0; ; climbed++) {
    const owner = deps.contentEntity(table);
    if (owner === undefined) return undefined;
    if (owner.kind === "collection") {
      return { kind: "collection", slug: owner.slug, id: rowId };
    }
    if (owner.kind === "single") return { kind: "single", slug: owner.slug };
    if (climbed === MAX_COMPONENT_DEPTH) break;
    const parent = await readParent(table, rowId, deps);
    if (parent === undefined) return undefined;
    table = parent.table;
    rowId = parent.id;
  }
  // Said rather than dropped in silence: the document this row sits in may
  // now show the previous value until something else expires it.
  getNextlyLogger().warn({
    kind: "contributed-write-parent-too-deep",
    message: `A write to "${tableName}" was not traced to its document within ${MAX_COMPONENT_DEPTH} field groups, so no cached read was expired for it.`,
    table: tableName,
  });
  return undefined;
}

/** The parent a field group's row names, or undefined when it names none. */
async function readParent(
  tableName: string,
  id: string,
  deps: ContentTargetDeps
): Promise<{ table: string; id: string } | undefined> {
  const runtime = deps.entityTable(tableName);
  const columns = parentColumns(runtime);
  if (columns === undefined) return undefined;
  const [row] = await (deps.db() as SelectOne)
    .select({ table: columns.parentTable, id: columns.parentId })
    .from(runtime)
    .where(eq(columns.key, id))
    .limit(1);
  return parentOf(row);
}

/** A field group table's key and parent columns, or undefined without them. */
function parentColumns(
  runtime: unknown
): { key: AnyColumn; parentTable: AnyColumn; parentId: AnyColumn } | undefined {
  if (runtime === undefined || runtime === null) return undefined;
  const columns = Object.values(getColumns(runtime as Table));
  const named = (name: string) => columns.find(column => column.name === name);
  const key = columns.find(column => column.primary);
  const parentTable = named(STORAGE_FORMAT.columns.parentTable);
  const parentId = named(STORAGE_FORMAT.columns.parentId);
  if (!key || !parentTable || !parentId) return undefined;
  return { key, parentTable, parentId };
}

/** The parent a read row names, when it names a table and a row of it. */
function parentOf(
  row: Record<string, unknown> | undefined
): { table: string; id: string } | undefined {
  const table = row?.table;
  const parent = row?.id;
  if (typeof table !== "string" || table === "") return undefined;
  const named = typeof parent === "string" || typeof parent === "number";
  return named ? { table, id: String(parent) } : undefined;
}
