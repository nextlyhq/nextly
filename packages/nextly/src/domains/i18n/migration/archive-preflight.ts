/**
 * Before a schema change archives translations, make sure the archive can take them.
 *
 * A field that stops being translated keeps its other languages' values only because they are
 * written to `nextly_i18n_archive` before its companion column is dropped. If that write cannot
 * happen, the change must not start at all: no main-table ALTER, no registry write, no companion
 * DDL. So every path that archives asks this first, before it changes anything, and a refusal
 * names what failed and says nothing was changed.
 *
 * @module domains/i18n/migration/archive-preflight
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../../schemas/nextly-i18n-archive/ddl";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";

import { lit, q } from "./ddl-types";

const ARCHIVE = "nextly_i18n_archive";

/**
 * Thrown inside the probe's transaction to roll it back. A `NextlyError`, so every adapter
 * hands it back unchanged rather than wrapping it as a database failure, which is what lets it
 * be told apart from a real one.
 */
const PROBE_ROLLED_BACK = NextlyError.internal({
  logContext: { reason: "archive write probe rolled back" },
});

/**
 * Creates the archive table when it is missing, and proves it accepts a row, without keeping
 * one: the probe row is written inside a transaction that is always rolled back.
 *
 * @param adapter - The database the change is about to run on
 * @param entity - The collection, Single or field group being changed, for the log
 * @throws NextlyError `NEXTLY_MIGRATION_APPLY_FAILED` when the table cannot be created or
 *   written, before anything else has changed
 */
export async function assertI18nArchiveWritable(
  adapter: DrizzleAdapter,
  entity: string
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  try {
    for (const statement of getI18nArchiveDdl(dialect)) {
      await adapter.executeQuery(statement);
    }
    // MySQL's table DDL cannot restore an index the table is missing; the repair is tolerated
    // when the index is already there, as the schema executor tolerates it.
    const indexRepair = getI18nArchiveIndexRepairDdl(dialect);
    if (indexRepair) {
      try {
        await adapter.executeQuery(indexRepair);
      } catch (error) {
        if (!isIdempotencyError(error)) throw error;
      }
    }
    await adapter.transaction(async ctx => {
      await ctx.execute(
        `INSERT INTO ${q(ARCHIVE, dialect)} ` +
          `(${q("collection", dialect)}, ${q("entry_id", dialect)}, ${q("locale", dialect)}, ${q("field", dialect)}, ${q("value", dialect)}) ` +
          `VALUES (${lit(entity)}, ${lit("preflight")}, ${lit("preflight")}, ${lit("preflight")}, NULL)`
      );
      throw PROBE_ROLLED_BACK;
    });
  } catch (error) {
    if (error === PROBE_ROLLED_BACK) return;
    const reason = error instanceof Error ? error.message : String(error);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage:
        "The localization archive could not be written, so nothing was changed. " +
        "A field that stops being translated keeps its other languages' values there.",
      logMessage: `localization archive not writable: ${reason}`,
      logContext: { entity },
      cause: error instanceof Error ? error : undefined,
    });
  }
}
