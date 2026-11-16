/**
 * `nextly_media_usage` on MySQL: which media items each document uses.
 *
 * One row is one media item used by one field of one document, in one
 * language. A document is a collection entry, a Single or an email template;
 * a Single has no entry, so its `document_id` is "" rather than NULL, and a
 * value no language owns (a field that is not translated) has a `locale` of
 * "": the unique index then holds on every dialect, with no partial index.
 * The rows are written in the transaction of the write that changes the
 * document, and go with their media item when it is deleted.
 *
 * @module schemas/media-usage/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

import { MEDIA_USAGE_INDEXES, mysqlIndexes } from "../_internal/core-indexes";
import { media } from "../media/mysql";

import { MEDIA_USAGE_FIELD_PATH_LENGTH, MEDIA_USAGE_TABLE } from "./table-name";

export const nextlyMediaUsageMysql = mysqlTable(
  MEDIA_USAGE_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // The item used: its rows are deleted with it by the database. As wide
    // as `media.id`, whose key it holds.
    mediaId: varchar("media_id", { length: 36 })
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    // "collection", "single" or "email-template".
    subjectKind: varchar("subject_kind", { length: 16 }).notNull(),
    // The collection's or Single's slug; "" for an email template.
    subjectSlug: varchar("subject_slug", { length: 191 }).notNull(),
    // The entry's or template's id; "" for a Single.
    documentId: varchar("document_id", { length: 191 }).notNull(),
    // The field's name, with the names of the groups, repeaters and field
    // groups it sits in before it, joined by dots; a longer path is stored
    // bounded to the column, ending in a hash of the whole path.
    fieldPath: varchar("field_path", {
      length: MEDIA_USAGE_FIELD_PATH_LENGTH,
    }).notNull(),
    // The language whose value uses the item; "" for a value every language
    // shares. The unique index over the six columns stays inside MySQL's
    // 3072-byte key limit: (16 + 191 + 191 + 255 + 35 + 36) characters at
    // four bytes each.
    locale: varchar("locale", { length: 35 }).notNull(),
    // The address the field names the item by, as the library gave it out:
    // the item's own when the content was saved, or an earlier one a Replace
    // kept the file of. NULL when the field names the item by its id, so a
    // Replace knows which uses go on showing the previous file.
    address: text("address"),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(MEDIA_USAGE_INDEXES, table)
);
