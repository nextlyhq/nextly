/**
 * The SEO plugin's own tables: bookkeeping only this plugin writes, kept out
 * of collections so a write is one statement rather than a whole entry save.
 *
 * A collection write keeps versions, records a content event, tracks media
 * use and runs every plugin's hooks, which is right for content and far too
 * much for a count bumped on every request. A table declared here has none of
 * that, and no admin screen, REST route or Direct API path either: only this
 * plugin reaches it, through `ctx.db`.
 *
 * Created as `seo__<name>` on every dialect. The prefix is declared rather
 * than left to default, because a table's name is permanent once a migration
 * ships it.
 *
 * @module schema/tables
 */
import {
  col,
  type ColumnBuilder,
  defineTable,
  type TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

/** The prefix every table of this plugin is created under. */
export const SCHEMA_PREFIX = "seo";

/**
 * The schema version the database must have applied before the plugin starts.
 * It moves with every migration module.
 */
export const SCHEMA_VERSION = 1;

/** The columns of {@link notFoundLog}, as `defineTable` checks and publishes them. */
type NotFoundLogColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly pathKey: ColumnBuilder<string, false, false>;
  readonly locale: ColumnBuilder<string, false, false>;
  readonly path: ColumnBuilder<string, false, false>;
  readonly asked: ColumnBuilder<string, true, false>;
  readonly hits: ColumnBuilder<number, false, false>;
  readonly firstSeen: ColumnBuilder<Date, false, false>;
  readonly lastSeen: ColumnBuilder<Date, false, false>;
  readonly kind: ColumnBuilder<string, false, false>;
};

/**
 * The log of addresses asked for that did not exist: one row per address in
 * a language, with how often and when it was first and last asked for.
 *
 * `pathKey` is the SHA-256 of the language and the address, so one address is
 * one row on every dialect whatever its length, and the unique index on it is
 * what makes two first requests for one address meet on one row. `hits` is
 * added to in the statement that counts a request (`increment`), so requests
 * arriving at once each count. `kind` is `missing` for a request that found
 * nothing and `moved` for an old address a deploy moved whose redirect could
 * not be saved.
 */
export const notFoundLog: TableDefinition<"not_found", NotFoundLogColumns> =
  defineTable<"not_found", NotFoundLogColumns>(
    "not_found",
    {
      id: col.id(),
      pathKey: col.char(64),
      locale: col.varchar(64),
      path: col.longText(),
      asked: col.longText({ nullable: true }),
      hits: col.integer(),
      firstSeen: col.timestamp(),
      lastSeen: col.timestamp(),
      kind: col.varchar(16),
    },
    {
      indexes: [
        { columns: ["pathKey"], unique: true },
        // The admin lists the most asked for first, and the log is pruned
        // to the most recent and the most asked for.
        { columns: ["hits"] },
        { columns: ["lastSeen"] },
      ],
    }
  );

/** Every table this plugin declares, in the order its migrations create them. */
export const SEO_TABLES: readonly [typeof notFoundLog] = [notFoundLog];
