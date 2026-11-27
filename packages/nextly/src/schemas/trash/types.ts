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
 * What other entries held pointing at the trashed one, which the delete
 * removed or cleared: a many-to-many junction's rows from each of them, or
 * the relation column of each of them that held its id. A restore puts each
 * back where the other entry is still there, and, for a column, still holds
 * nothing, so a later edit is never undone.
 */
export type KeptIncoming =
  | {
      kind: "links";
      /** The junction, and its column naming the other entry, then this one. */
      table: string;
      sourceColumn: string;
      targetColumn: string;
      /** The other entries' table, and their ids. */
      sourceTable: string;
      sourceIds: string[];
      /** The entity and field that held the links, checked again on restore. */
      source?: IncomingSource;
    }
  | {
      kind: "column";
      /**
       * The table holding the column: the other entity's own table, or its
       * table of rows per language for a translated relation.
       */
      table: string;
      column: string;
      /** The rows of the other entity's own table that held the id. */
      ids: string[];
      /**
       * The rows per language that held it, by entity id and language: a
       * language row has no id of its own.
       */
      languageRows?: { parent: string; locale: string }[];
      /** The entity and field that held the id, checked again on restore. */
      source?: IncomingSource;
    };

/** The entity and field a kept reference came from. */
export interface IncomingSource {
  kind: "collection" | "single";
  slug: string;
  field: string;
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
  /** What other entries held pointing at it; absent where none was kept. */
  incoming?: KeptIncoming[];
  /**
   * The registry id of the collection it was deleted from: a collection
   * deleted and made again under the same slug is another collection, which
   * the entry is never restored into.
   */
  collectionId?: string;
  /**
   * The entry in the shape a read gives it, as its deleted event carried it:
   * what a restore's created event carries.
   */
  document: Record<string, unknown>;
}
