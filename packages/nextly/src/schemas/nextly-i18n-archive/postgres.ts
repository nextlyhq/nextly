import {
  pgTable,
  bigserial,
  text,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

import { UNKNOWN_ARCHIVE_KIND } from "./ddl";

/**
 * Archive of non-default-locale translations removed when localization is disabled on a
 * field/collection. See `./ddl.ts` for the out-of-band bootstrap DDL. `id` is DB-generated.
 */
export const nextlyI18nArchive = pgTable(
  "nextly_i18n_archive",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    collection: text("collection").notNull(),
    // Which kind of entity archived the row: `collection`, `single` or `fieldGroup`. A field
    // group's slug may equal a collection's or a Single's, so the slug alone cannot say whose a
    // row is. Rows from before this column existed take the default, unknown, since collections,
    // Singles and field groups all archived then.
    entityKind: varchar("entity_kind", { length: 20 })
      .notNull()
      .default(UNKNOWN_ARCHIVE_KIND),
    entryId: text("entry_id").notNull(),
    locale: varchar("locale", { length: 20 }).notNull(),
    field: text("field").notNull(),
    value: text("value"),
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    index("nextly_i18n_archive_lookup_idx").on(
      t.collection,
      t.entryId,
      t.locale
    ),
  ]
);
