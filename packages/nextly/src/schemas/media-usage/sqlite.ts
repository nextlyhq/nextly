/**
 * `nextly_media_usage` on SQLite: which media items each document uses.
 *
 * One row is one media item used by one field of one document, in one
 * language. A document is a collection entry, a Single or an email template;
 * a Single has no entry, so its `document_id` is "" rather than NULL, and a
 * value no language owns (a field that is not translated) has a `locale` of
 * "": the unique index then holds on every dialect, with no partial index.
 * The rows are written in the transaction of the write that changes the
 * document, and go with their media item when it is deleted.
 *
 * @module schemas/media-usage/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { MEDIA_USAGE_INDEXES, sqliteIndexes } from "../_internal/core-indexes";
import { media } from "../media/sqlite";

import { MEDIA_USAGE_TABLE } from "./table-name";

export const nextlyMediaUsageSqlite = sqliteTable(
  MEDIA_USAGE_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // The item used: its rows are deleted with it by the database.
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    // "collection", "single" or "email-template".
    subjectKind: text("subject_kind").notNull(),
    // The collection's or Single's slug; "" for an email template.
    subjectSlug: text("subject_slug").notNull(),
    // The entry's or template's id; "" for a Single.
    documentId: text("document_id").notNull(),
    // The field's name, with the names of the groups, repeaters and field
    // groups it sits in before it, joined by dots.
    fieldPath: text("field_path").notNull(),
    // The language whose value uses the item; "" for a value every language
    // shares.
    locale: text("locale").notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(MEDIA_USAGE_INDEXES, table)
);
