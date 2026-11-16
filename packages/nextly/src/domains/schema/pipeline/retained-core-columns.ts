/**
 * The core tables a push hands drizzle-kit, with what the database keeps on
 * them that Nextly no longer declares.
 *
 * drizzle-kit plans a drop for every live column its runtime table lacks. On
 * SQLite and MySQL it compares the whole database, so the media table's
 * retired `sizes` column, which Nextly keeps until
 * `nextly media remove-sizes --apply --drop`, read as a column to drop. The
 * destructive-statement guard then refused the whole push, the columns it was
 * adding included, and a SQLite rebuild of the table would have copied
 * every column but that one. The core reconcile composes the same column in
 * for the same reason; both take it from `RETAINED_SIZES_COLUMN`.
 *
 * @module domains/schema/pipeline/retained-core-columns
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { RETAINED_SIZES_COLUMN } from "../../media/retired-image-sizes-constants";
import { coreTableWithLiveContributions } from "../services/core-table-contributions";

/**
 * `tables`, keyed by SQL table name, with the media table rebuilt to carry
 * the retired `sizes` column when `retained` says the database still has it.
 * Unchanged otherwise, and when the bundle holds no media table.
 */
export function withRetainedSizesColumn(
  tables: Record<string, unknown>,
  dialect: SupportedDialect,
  retained: boolean
): Record<string, unknown> {
  if (!retained || tables.media === undefined) return tables;
  const media = coreTableWithLiveContributions(
    "media",
    {
      name: "media",
      // Only the column's name is read here: the type comes from the
      // contribution, as the column was declared.
      columns: [{ name: RETAINED_SIZES_COLUMN.name, type: "", nullable: true }],
    },
    [RETAINED_SIZES_COLUMN],
    dialect
  );
  return media === undefined ? tables : { ...tables, media };
}
