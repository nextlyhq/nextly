/**
 * What a create does about a table already standing where it is about to build.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that exists, on every dialect, and the
 * statement runner tolerates already-applied index statements so half-applied schema can be
 * finished. Together those make a create over a LEFTOVER table silent: a create interrupted between
 * its DDL and its registry write leaves a table no row describes, and a retry with different fields
 * would adopt that table unchanged, recording itself applied over columns it never made.
 *
 * So a standing table is never built over. Which way it goes is decided by the one thing a leftover
 * cannot have:
 *
 * - **Every table empty:** it is wreckage of an interrupted attempt. The caller has re-asserted,
 *   inside the schema lock, that nothing registered owns the name, and a table outside every
 *   registered entity's family is one no Nextly path writes rows through. The family is dropped, so
 *   the create renders every column from its own request.
 * - **Any table holding rows:** it is somebody's data, and dropping it would destroy what proves it
 *   is not wreckage. The create is refused, naming each such table and how many rows it holds.
 *   Nothing has run and nothing is recorded, so the name stays free for a retry once the table is
 *   dealt with.
 *
 * Every table is probed before any is dropped, so a refusal leaves the whole family as it stood.
 * One rule for every kind's create: a collection's, a field group's and a Single's.
 *
 * @module domains/schema/services/leftover-storage
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import {
  countTableRows,
  readReferencingTables,
  tableHasRows,
} from "../pipeline/live-table-facts";

/** The adapter surface the rule needs: whether a table stands, the database, and a drop. */
export interface LeftoverStorageAdapter {
  tableExists(tableName: string): Promise<boolean>;
  getDrizzle(): unknown;
  getCapabilities(): { dialect: SupportedDialect };
  dropTable(
    tableName: string,
    options?: { ifExists?: boolean; cascade?: boolean }
  ): Promise<void>;
}

export interface ClearLeftoverStorageArgs {
  adapter: LeftoverStorageAdapter;
  /** The kind of entity being created, named in the refusal and the log. */
  kind: "collection" | "fieldGroup" | "single";
  slug: string;
  /** The main table the create is about to build. */
  tableName: string;
  /**
   * Drop the main table and what the kind keeps beside it (its translations table, and for a
   * Single its field-group data). Called only once every table has been found empty, after the
   * tables referencing the main one are gone.
   */
  dropFamily: () => Promise<void>;
  /**
   * Whether this kind's create makes junction tables, which reference its main table. A field
   * group makes none (a component row keeps a many-to-many as a list of its own), so every table
   * referencing a field group's leftover belongs to something else.
   */
  makesJunctionTables: boolean;
  logger: { info(message: string): void };
}

/** A table holding rows, and how many. */
interface OccupiedTable {
  table: string;
  rows: number;
}

const KIND_NAMES: Record<ClearLeftoverStorageArgs["kind"], string> = {
  collection: "collection",
  fieldGroup: "field group",
  single: "Single",
};

/**
 * Whether `candidate`, a table referencing `tableName`, is a junction table a create generated for
 * it: named as `junctionTableNameBetween` names one, from both tables sorted and the field, and
 * holding the column a junction keys its source by. Anything else referencing a leftover table is
 * someone else's (a schema extension may reference a `comp_` table), and is never dropped.
 */
async function isGeneratedJunctionOf(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  candidate: string
): Promise<boolean> {
  const named =
    candidate.startsWith(`${tableName}_`) ||
    candidate.includes(`_${tableName}_`);
  if (!named) return false;
  const sourceColumn = `${tableName.replace(/^dc_/, "")}_id`;
  const columns =
    (await introspectLiveColumns(db, dialect, [candidate])).tables[0]
      ?.columns ?? [];
  return columns.some(column => column.name === sourceColumn);
}

/** The rows each table of `tables` holds, for those holding any. */
async function occupiedAmong(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<OccupiedTable[]> {
  const occupied: OccupiedTable[] = [];
  for (const table of tables) {
    if (await tableHasRows(db, dialect, table)) {
      occupied.push({ table, rows: await countTableRows(db, dialect, table) });
    }
  }
  return occupied;
}

/**
 * Leave the create's table name pointing at nothing, or refuse the create.
 *
 * The family is the main table, its `_locales` translations table (looked at whether or not the
 * main table survived: a drop that cascaded from it can leave the translations behind) and the
 * junction tables a create of this kind generated for it, read from the live catalog because a
 * leftover's field list is gone with its registry row. A table referencing the main one that is
 * not such a junction belongs to something else, so the create is refused rather than drop it.
 * Junction tables are dropped first: they hold the foreign keys, and MySQL refuses to drop a parent
 * a reference still points at.
 */
export async function clearLeftoverStorage(
  args: ClearLeftoverStorageArgs
): Promise<void> {
  const { adapter, tableName } = args;
  const companion = `${tableName}_locales`;
  const mainStands = await adapter.tableExists(tableName);
  const companionStands = await adapter.tableExists(companion);
  if (!mainStands && !companionStands) return;

  const db = adapter.getDrizzle();
  const dialect = adapter.getCapabilities().dialect;
  const referencing = mainStands
    ? (await readReferencingTables(db, dialect, tableName)).filter(
        name => name !== companion
      )
    : [];
  const { junctions, others } = await sortReferencing(
    args,
    db,
    dialect,
    referencing
  );
  if (others.length > 0) throw referencedRefusal(args, others);

  const family = [
    ...(mainStands ? [tableName] : []),
    ...(companionStands ? [companion] : []),
    ...junctions,
  ];
  const occupied = await occupiedAmong(db, dialect, family);
  if (occupied.length > 0) throw occupiedRefusal(args, occupied);

  args.logger.info(
    `Dropping empty unregistered tables ${family.map(table => `"${table}"`).join(", ")} before creating the ${KIND_NAMES[args.kind]} "${args.slug}"`
  );
  for (const table of junctions) {
    await adapter.dropTable(table, {
      ifExists: true,
      cascade: dialect === "postgresql",
    });
  }
  await args.dropFamily();
}

/** The tables referencing the leftover, as this kind's own junctions and everything else. */
async function sortReferencing(
  args: ClearLeftoverStorageArgs,
  db: unknown,
  dialect: SupportedDialect,
  referencing: readonly string[]
): Promise<{ junctions: string[]; others: string[] }> {
  const junctions: string[] = [];
  const others: string[] = [];
  for (const table of referencing) {
    const own =
      args.makesJunctionTables &&
      (await isGeneratedJunctionOf(db, dialect, args.tableName, table));
    (own ? junctions : others).push(table);
  }
  return { junctions, others };
}

/** The refusal of a create whose leftover other tables reference. */
function referencedRefusal(
  args: ClearLeftoverStorageArgs,
  others: readonly string[]
): NextlyError {
  const { kind, slug, tableName } = args;
  const named = others.map(table => `"${table}"`).join(", ");
  return NextlyError.conflict({
    reason: "state",
    message:
      `Creating the ${KIND_NAMES[kind]} "${slug}" was refused: "${tableName}" already exists, ` +
      `and ${named} ${others.length === 1 ? "references" : "reference"} it, which nothing ` +
      "registered owns. Drop or rename those tables, then retry the create.",
    logContext: {
      reason: "create-table-referenced",
      kind,
      slug,
      tableName,
      referencedBy: others,
    },
  });
}

/** The refusal of a create whose leftover family holds rows, naming each table and its rows. */
function occupiedRefusal(
  args: ClearLeftoverStorageArgs,
  occupied: readonly OccupiedTable[]
): NextlyError {
  const { kind, slug, tableName } = args;
  const named = occupied
    .map(
      ({ table, rows }) => `"${table}" (${rows} ${rows === 1 ? "row" : "rows"})`
    )
    .join(", ");
  return NextlyError.conflict({
    reason: "state",
    message:
      `Creating the ${KIND_NAMES[kind]} "${slug}" was refused: ${named} already ` +
      `${occupied.length === 1 ? "exists and holds" : "exist and hold"} rows, but nothing ` +
      "registered describes them. Drop or rename those tables, then retry the create.",
    logContext: {
      reason: "create-table-occupied",
      kind,
      slug,
      tableName,
      occupied,
    },
  });
}
