import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";

/**
 * Archive of non-default-locale translations removed when localization is disabled on a
 * field/collection. See `./ddl.ts` for the out-of-band bootstrap DDL. `id` is DB-generated.
 */
export const nextlyI18nArchive = sqliteTable(
  "nextly_i18n_archive",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    collection: text("collection").notNull(),
    entryId: text("entry_id").notNull(),
    locale: text("locale").notNull(),
    field: text("field").notNull(),
    value: text("value"),
    // `$defaultFn` alone fills the column only on inserts that go through
    // Drizzle. The localization-disable path archives with a raw
    // `INSERT ... SELECT` that names no `archived_at`, so the column needs a
    // default the database itself applies — matching `getI18nArchiveDdl`,
    // which has always created this table with `DEFAULT (unixepoch())`.
    archivedAt: integer("archived_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$defaultFn(() => new Date()),
  },
  t => [
    index("nextly_i18n_archive_lookup_idx").on(
      t.collection,
      t.entryId,
      t.locale
    ),
  ]
);
