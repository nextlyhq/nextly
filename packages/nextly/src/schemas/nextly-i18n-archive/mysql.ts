import {
  mysqlTable,
  bigint,
  varchar,
  text,
  datetime,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Archive of non-default-locale translations removed when localization is disabled on a
 * field/collection. See `./ddl.ts` for the out-of-band bootstrap DDL. `id` is DB-generated.
 */
export const nextlyI18nArchive = mysqlTable(
  "nextly_i18n_archive",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    collection: varchar("collection", { length: 191 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    locale: varchar("locale", { length: 20 }).notNull(),
    field: varchar("field", { length: 191 }).notNull(),
    value: text("value"),
    archivedAt: datetime("archived_at", { fsp: 3 }).notNull(),
  },
  t => [
    index("nextly_i18n_archive_lookup_idx").on(
      t.collection,
      t.entryId,
      t.locale
    ),
  ]
);
