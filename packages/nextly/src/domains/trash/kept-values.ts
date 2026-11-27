/**
 * How a row read from its table is kept in the trash's JSON column, and given
 * back to its table on a restore.
 *
 * A row read through the adapter holds JavaScript values: dates as `Date`,
 * byte columns as `Uint8Array`, JSON columns as objects on PostgreSQL and
 * MySQL and as text on SQLite. A JSON column keeps none of `Date` or bytes, so
 * each value is tagged with what it was, and a restore hands the adapter the
 * same kind of value it read; the adapter then writes it as it writes any row.
 *
 * @module domains/trash/kept-values
 */
import type { KeptRow, KeptValue } from "../../schemas/trash";

/** One value, tagged with how to give it back. */
function keepValue(value: unknown): KeptValue {
  if (value instanceof Date) return { t: "date", v: value.toISOString() };
  if (value instanceof Uint8Array) {
    return { t: "bytes", v: Buffer.from(value).toString("base64") };
  }
  return { t: "value", v: value === undefined ? null : value };
}

/** One kept value, as the adapter read it. */
function givenBack(kept: KeptValue): unknown {
  switch (kept.t) {
    case "date":
      return new Date(kept.v);
    case "bytes":
      return Buffer.from(kept.v, "base64");
    default:
      return kept.v;
  }
}

/** A row as the trash keeps it. */
export function keepRow(row: Record<string, unknown>): KeptRow {
  const kept: KeptRow = {};
  for (const [column, value] of Object.entries(row)) {
    kept[column] = keepValue(value);
  }
  return kept;
}

/** A kept row, as its table's adapter read it. */
export function rowGivenBack(kept: KeptRow): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(kept)) {
    row[column] = givenBack(value);
  }
  return row;
}

/** One column of a kept row, given back; undefined where it has none. */
export function keptColumn(kept: KeptRow, column: string): unknown {
  const value = kept[column];
  return value === undefined ? undefined : givenBack(value);
}
