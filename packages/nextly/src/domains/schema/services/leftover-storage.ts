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
 * Leave the create's table name pointing at nothing, or refuse the create.
 *
 * The family is the main table, its `_locales` translations table and every table referencing the
 * main one (a relationship's junction tables, read from the live catalog because a leftover's field
 * list is gone with its registry row). Referencing tables are dropped first: they hold the foreign
 * keys, and MySQL refuses to drop a parent a reference still points at.
 */
export async function clearLeftoverStorage(
  args: ClearLeftoverStorageArgs
): Promise<void> {
  const { adapter, kind, slug, tableName } = args;
  if (!(await adapter.tableExists(tableName))) return;

  const db = adapter.getDrizzle();
  const dialect = adapter.getCapabilities().dialect;
  const companion = `${tableName}_locales`;
  const referencing = (
    await readReferencingTables(db, dialect, tableName)
  ).filter(name => name !== companion);
  const family = [
    tableName,
    ...((await adapter.tableExists(companion)) ? [companion] : []),
    ...referencing,
  ];

  const occupied: OccupiedTable[] = [];
  for (const table of family) {
    if (await tableHasRows(db, dialect, table)) {
      occupied.push({ table, rows: await countTableRows(db, dialect, table) });
    }
  }
  if (occupied.length > 0) {
    const named = occupied
      .map(
        ({ table, rows }) =>
          `"${table}" (${rows} ${rows === 1 ? "row" : "rows"})`
      )
      .join(", ");
    throw NextlyError.conflict({
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

  args.logger.info(
    `Dropping empty unregistered table "${tableName}" before creating the ${KIND_NAMES[kind]} "${slug}"`
  );
  for (const table of referencing) {
    await adapter.dropTable(table, {
      ifExists: true,
      cascade: dialect === "postgresql",
    });
  }
  await args.dropFamily();
}
