/**
 * What a row of `nextly_trash` keeps.
 *
 * @module schemas/trash/types
 */

/** What was trashed: an entry of a collection, or a media file. */
export type TrashKind = "entry" | "media";

/**
 * One stored value, tagged with how it is put back: a date as its ISO text, a
 * byte value as base64, and every other value as itself. A JSON column cannot
 * tell a date or a buffer from text, so the tag is what lets a restore hand
 * each column back the value it was read as.
 */
export type KeptValue =
  | { t: "date"; v: string }
  | { t: "bytes"; v: string }
  | { t: "value"; v: unknown };

/** One stored row, column by column. */
export type KeptRow = Record<string, KeptValue>;

/** The rows one table held for the item. */
export interface KeptTableRows {
  /** The table, as it was named when the item was trashed. */
  table: string;
  rows: KeptRow[];
}

/**
 * The links of one many-to-many field, which live in a table the schema
 * registry does not know: the junction's name and its two link columns,
 * with the ids the item linked to, in order.
 */
export interface KeptLinks {
  table: string;
  sourceColumn: string;
  targetColumn: string;
  /** The collection the links point at, checked before each is put back. */
  targetSlug: string;
  targetIds: string[];
}

/**
 * Everything a trashed entry stored, as its rows were: its own row, its rows
 * in each language, its field-group rows at every depth and theirs in each
 * language, the links it held, and where its translated values came from.
 * Its version history stays in the versions table under its id.
 */
export interface TrashedEntry {
  /** The entry's own table, first, then every other table it had rows in. */
  tables: KeptTableRows[];
  links: KeptLinks[];
  /**
   * The entry in the shape a read gives it, as its deleted event carried it:
   * what a restore's created event carries.
   */
  document: Record<string, unknown>;
}
