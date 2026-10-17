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
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
  getI18nArchiveKindUpgradeDdl,
} from "../../../schemas/nextly-i18n-archive";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";

/** Creates the archive when it is missing and brings an older one up to date. Idempotent. */
export async function ensureI18nArchive(
  adapter: { executeQuery(sql: string): Promise<unknown> },
  dialect: SupportedDialect
): Promise<void> {
  for (const statement of getI18nArchiveDdl(dialect)) {
    await adapter.executeQuery(statement);
  }
  const upgrades = [
    getI18nArchiveIndexRepairDdl(dialect),
    getI18nArchiveKindUpgradeDdl(dialect),
  ];
  for (const statement of upgrades) {
    if (statement === null) continue;
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      if (!isIdempotencyError(error)) throw error;
    }
  }
}
