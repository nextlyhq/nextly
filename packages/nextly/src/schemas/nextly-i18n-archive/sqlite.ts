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
    archivedAt: integer("archived_at", { mode: "timestamp" })
      .notNull()
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
