/**
 * Makes `nextly_i18n_archive` ready to be written, for the paths that write it without
 * `nextly migrate` having run first: the Schema Builder's saves of collections, Singles and field
 * groups.
 *
 * `nextly migrate` and boot reach the same shape through the core reconcile. These paths cannot
 * count on it, so they create the table when it is missing and bring an older one up to date:
 * MySQL's lookup index, which its table DDL cannot restore, and the `entity_kind` column, which
 * `CREATE TABLE IF NOT EXISTS` cannot add to a table that exists. Both are attempted and their
 * "already there" answer tolerated, which is one round trip rather than a check and then the
 * statement.
 *
 * @module domains/i18n/migration/ensure-archive
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
  getI18nArchiveKindUpgradeDdl,
} from "../../../schemas/nextly-i18n-archive";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";

/** What the localization paths send their schema statements through. */
export interface I18nStatementRunner {
  executeQuery(sql: string): Promise<unknown>;
}

/**
 * Whether `adapter` is a whole `DrizzleAdapter`, whose statements can wait for a busy table on a
 * session of their own; a narrower one offers no session.
 */
function isWholeAdapter(
  adapter: I18nStatementRunner
): adapter is I18nStatementRunner & DrizzleAdapter {
  const methods = [
    "withSession",
    "queryStatement",
    "getCapabilities",
    "inTransaction",
  ];
  return methods.every(
    name => typeof Reflect.get(adapter, name) === "function"
  );
}

/**
 * Runs a localization path's schema statements in order. On a whole adapter each one waits for a
 * table another database session holds in short tries, bounded by `NEXTLY_LOCK_TIMEOUT` /
 * `NEXTLY_LOCK_TIMEOUT_TOTAL`, and one that stays busy stops with `NEXTLY_TABLE_BUSY` naming the
 * table and its holder (`runStatementsInTries`), rather than waiting without bound. Elsewhere they
 * run once each, as they always have: on a narrower adapter, and inside an open transaction.
 * `change` names them in a report; `name` names each one.
 */
export async function runI18nSchemaStatements(
  adapter: I18nStatementRunner,
  statements: readonly string[],
  change: string,
  name?: (index: number) => string
): Promise<void> {
  // Inside an open transaction a session of its own is refused (`withSession`), so the statements
  // run on the transaction's connection, once each.
  if (!isWholeAdapter(adapter) || adapter.inTransaction()) {
    for (const statement of statements) await adapter.executeQuery(statement);
    return;
  }
  // Loaded here, not at the top: the tries' engine is needed only once a statement is sent, and
  // every path that imports this module would otherwise load it too.
  const [{ runStatementsInTries }, { busyTableBounds }, { consoleLogger }] =
    await Promise.all([
      import("../../schema/busy-table/run-on-session"),
      import("../../schema/busy-table/bounds"),
      import("../../../shared/types"),
    ]);
  await runStatementsInTries(adapter, statements, {
    change,
    bounds: busyTableBounds({ env: process.env }),
    notify: line => consoleLogger.warn(line),
    appliedBefore: [],
    ...(name === undefined ? {} : { name }),
  });
}

/** What a busy-table report calls the archive's own statements. */
const ARCHIVE_CHANGE = "the localization archive's setup";

/**
 * Creates the archive when it is missing and brings an older one up to date. Idempotent. Each
 * statement waits for a busy table in tries (`runI18nSchemaStatements`).
 */
export async function ensureI18nArchive(
  adapter: I18nStatementRunner,
  dialect: SupportedDialect
): Promise<void> {
  await runI18nSchemaStatements(
    adapter,
    getI18nArchiveDdl(dialect),
    ARCHIVE_CHANGE
  );
  const upgrades = [
    getI18nArchiveIndexRepairDdl(dialect),
    getI18nArchiveKindUpgradeDdl(dialect),
  ];
  for (const statement of upgrades) {
    if (statement === null) continue;
    // One statement per call, so its "already there" answer is tolerated on its own, as the tries
    // let every failure other than a busy table through as it is.
    try {
      await runI18nSchemaStatements(adapter, [statement], ARCHIVE_CHANGE);
    } catch (error) {
      if (!isIdempotencyError(error)) throw error;
    }
  }
}
