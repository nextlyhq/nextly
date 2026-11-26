/**
 * A Drizzle handle for the companion's `_updated_at` column alone.
 *
 * The column is deliberately absent from the companion's main runtime table: that table is
 * registered for every localized entity including Schema Builder collections held in the registry,
 * whose companions may predate the column, and declaring it there would make the ordinary
 * localized read's bare `select()` name a column those tables do not have.
 *
 * So the stamp gets its own narrow table object instead, carrying only the composite key and the
 * timestamp. Two things follow from it being a real Drizzle handle rather than a hand-built SQL
 * string, and both are the reason this module exists:
 *
 *  - the stamp READ is an ordinary Drizzle query, so it is not raw SQL in product code;
 *  - the stamp WRITE can encode its value through the column's own `mapToDriverValue`, which is
 *    what keeps a `DATETIME(3)` on a non-UTC MySQL server from storing a local wall clock while
 *    every timestamp written through Drizzle stores UTC. Those two bases differing is not a
 *    cosmetic difference here: the back-fill seeds from Drizzle-written version rows, so a mixed
 *    pair can order backwards and invert the staleness answer.
 *
 * @module domains/i18n/runtime/companion-stamp-table
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedCore } from "../../../database/dialect-tables";
import { COMPANION_UPDATED_AT_COLUMN } from "../companion-columns";

/** The stamp table's columns: the composite key, and the timestamp itself. */
export interface CompanionStampTable {
  table: unknown;
  parent: unknown;
  locale: unknown;
  updatedAt: unknown;
}

/**
 * Build the narrow `(_parent, _locale, _updated_at)` handle for one companion.
 *
 * The key columns are declared to match what the companion's `CREATE TABLE` emits — `TEXT` /
 * `VARCHAR(36)` for the parent and `VARCHAR(20)` for the locale — because a query binds a value
 * against the column it is comparing to, and a mismatch is the kind of thing that works on two
 * dialects and not the third.
 */
export function buildCompanionStampTable(
  companionTableName: string,
  dialect: SupportedDialect
): CompanionStampTable {
  if (dialect === "postgresql") {
    const { pgTable, text, timestamp, varchar } = loadedCore("postgresql");
    const table = pgTable(companionTableName, {
      _parent: text("_parent").notNull(),
      _locale: varchar("_locale", { length: 20 }).notNull(),
      [COMPANION_UPDATED_AT_COLUMN]: timestamp(COMPANION_UPDATED_AT_COLUMN, {
        withTimezone: true,
      }),
    });
    return {
      table,
      parent: table._parent,
      locale: table._locale,
      updatedAt: table[COMPANION_UPDATED_AT_COLUMN],
    };
  }

  if (dialect === "mysql") {
    const { datetime, mysqlTable, varchar } = loadedCore("mysql");
    const table = mysqlTable(companionTableName, {
      _parent: varchar("_parent", { length: 36 }).notNull(),
      _locale: varchar("_locale", { length: 20 }).notNull(),
      [COMPANION_UPDATED_AT_COLUMN]: datetime(COMPANION_UPDATED_AT_COLUMN, {
        fsp: 3,
      }),
    });
    return {
      table,
      parent: table._parent,
      locale: table._locale,
      updatedAt: table[COMPANION_UPDATED_AT_COLUMN],
    };
  }

  const { integer, sqliteTable, text } = loadedCore("sqlite");
  const table = sqliteTable(companionTableName, {
    _parent: text("_parent").notNull(),
    _locale: text("_locale").notNull(),
    [COMPANION_UPDATED_AT_COLUMN]: integer(COMPANION_UPDATED_AT_COLUMN, {
      mode: "timestamp",
    }),
  });
  return {
    table,
    parent: table._parent,
    locale: table._locale,
    updatedAt: table[COMPANION_UPDATED_AT_COLUMN],
  };
}
