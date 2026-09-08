/**
 * Encoding for the companion's `_updated_at` value (i18n B2).
 *
 * `upsertCompanionRow` builds one `INSERT ... ON CONFLICT` by hand — it has to, because the
 * conflict clause differs per dialect and one Drizzle query cannot express all three — so its
 * values are bound straight to the driver. A `Date` bound that way writes the LOCAL wall clock
 * into a column that records no time zone, while every timestamp Drizzle writes is UTC. On a UTC
 * server the two agree and nothing looks wrong, which is why the difference survives CI.
 *
 * That matters here rather than merely being untidy: the staleness comparison reads BOTH bases,
 * because the back-fill seeds from Drizzle-written version rows. A mixed pair can order backwards,
 * which inverts the answer rather than degrading it.
 *
 * @module domains/i18n/runtime/companion-stamp-column
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { buildCompanionStampTable } from "./companion-stamp-table";

/** The encoder Drizzle attaches to a built column. */
interface DriverEncodable {
  mapToDriverValue: (value: Date) => unknown;
}

function isEncodable(column: unknown): column is DriverEncodable {
  return (
    typeof column === "object" &&
    column !== null &&
    typeof (column as DriverEncodable).mapToDriverValue === "function"
  );
}

/**
 * Encode a `Date` the way Drizzle would before binding it into a raw statement.
 *
 * Asks the SAME column definition the stamp read selects through, so the value written and the
 * value read back cannot disagree about their encoding — the alternative, a second per-dialect
 * mapping written here, is the shape of duplication this codebase has a rule against.
 *
 * `mapToDriverValue` lives on a BUILT column rather than on a column builder, so the table has to
 * be constructed to reach it. The table name is irrelevant to the encoding and any name would do;
 * the caller's is passed so nothing has to invent one.
 *
 * Falls back to the raw `Date` when the column exposes no encoder, so a Drizzle version whose
 * column shape changes degrades to today's behaviour instead of throwing on a write path.
 */
export function encodeStamp(
  value: Date,
  companionTableName: string,
  dialect: SupportedDialect
): unknown {
  const { updatedAt } = buildCompanionStampTable(companionTableName, dialect);
  return isEncodable(updatedAt) ? updatedAt.mapToDriverValue(value) : value;
}
