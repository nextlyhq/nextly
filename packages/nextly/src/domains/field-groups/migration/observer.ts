/**
 * Binds the migration's observations to the schema pipeline's introspection.
 *
 * The steps decide against an injected `StorageObserver` so they stay testable
 * without a database. This is the one implementation of that seam, and it reads
 * through `introspectLiveSnapshot` rather than issuing its own catalog queries:
 * that function already answers the same question for all three dialects, and a
 * second implementation of "what does this table look like" would drift from it
 * exactly the way independent naming rules have drifted here before.
 *
 * @module domains/field-groups/migration/observer
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";

import type { ObservedColumn, StorageObserver } from "./steps";

/** The registry column holding a row's physical table name. */
const REGISTRY_TABLE_NAME_COLUMN = "table_name";

/** Observe a live database through the schema pipeline's introspection. */
export function createStorageObserver(
  adapter: DrizzleAdapter,
  identifierCase: IdentifierCaseRules
): StorageObserver {
  const dialect = adapter.getCapabilities().dialect;

  async function snapshotOf(table: string) {
    const snapshot = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      dialect,
      [table]
    );
    // Matched under the server's own rules, not by exact spelling. MySQL with
    // `lower_case_table_names=1` answers a query for a mixed-case name while
    // `information_schema` reports the lowercased one, so an exact comparison
    // discards a snapshot that describes the very table that was asked for --
    // and the caller then reads an existing table as missing.
    const catalog = indexCatalog(
      snapshot.tables.map(entry => entry.name),
      identifierCase.tables
    );
    const resolved = resolveCatalogName(catalog, table);
    if (resolved === undefined) return undefined;
    return snapshot.tables.find(entry => entry.name === resolved);
  }

  return {
    tables: async () => adapter.listTables(),

    columns: async (_session, table): Promise<ObservedColumn[] | undefined> => {
      const spec = await snapshotOf(table);
      if (spec === undefined) return undefined;
      return spec.columns.map(column => ({
        name: column.name,
        type: column.type,
      }));
    },

    pointers: async (_session, registryTable): Promise<string[]> => {
      // Addressed by a name the ORM's schema registry does not know: it resolves
      // tables exactly by the name their Drizzle definition declares, and during
      // a run the registry is under whichever name the plan has reached. Issued
      // as a Drizzle statement so the identifier is quoted for the dialect in
      // use rather than by hand.
      const rows = await adapter.queryStatement(
        sql`SELECT ${sql.identifier(REGISTRY_TABLE_NAME_COLUMN)} FROM ${sql.identifier(registryTable)}`
      );
      return rows
        .map(row => row[REGISTRY_TABLE_NAME_COLUMN])
        .filter((value): value is string => typeof value === "string");
    },

    indexNames: async (table): Promise<string[] | undefined> => {
      const spec = await snapshotOf(table);
      if (spec === undefined) return undefined;
      // Preserved as `undefined` rather than collapsed to `[]`, so a caller can
      // tell "this table has no indexes" from "nobody recorded any".
      if (spec.indexes === undefined) return undefined;
      return spec.indexes.map(index => index.name);
    },
  };
}

/**
 * Refuse when a rename did not carry a table's indexes with it.
 *
 * Renaming a table keeps its indexes on all three dialects, so a name missing
 * afterwards means one was dropped rather than moved. Compared **by name**
 * rather than by count: a count survives losing one index and gaining another,
 * which is exactly the shape of the SQLite index loss this checks for.
 *
 * `before` being `undefined` means the step could not observe the source — the
 * rename had already committed when it ran — and there is nothing to compare
 * against. That is reported rather than silently passing, because the gap is
 * real: a crash between a rename and its verification hides index loss, and only
 * the end-of-run structural verification can catch it.
 */
export function findLostIndexes(
  before: string[] | undefined,
  after: string[] | undefined
): { comparable: false } | { comparable: true; lost: string[] } {
  if (before === undefined || after === undefined) return { comparable: false };
  const present = new Set(after);
  return { comparable: true, lost: before.filter(name => !present.has(name)) };
}

/** Build the refusal a lost index deserves. */
export function refuseLostIndexes(args: {
  table: string;
  lost: string[];
}): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration lost indexes while renaming ${args.table}`,
    logContext: {
      reason: "rename did not carry the table's indexes",
      table: args.table,
      lost: args.lost,
    },
  });
}
