/**
 * `nextly_translation_sources` on MySQL: the source text each translation was made from.
 *
 * One row is one version of one field's value in the language other languages
 * were translated from, kept for as long as a translation made from it is
 * recorded. Every translation made from that version shares the row: it is
 * found by the columns its provenance names its source by (`source_locale`,
 * `field_path` and `source_fingerprint`), so no row of either table points at
 * the other.
 *
 * @module schemas/translation-sources/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { datetime, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";

import {
  mysqlIndexes,
  TRANSLATION_SOURCES_INDEXES,
} from "../_internal/core-indexes-mysql";
import {
  TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
  TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH,
} from "../translation-provenance/table-name";
import type { ProvenanceScopeKind } from "../translation-provenance/types";

import { TRANSLATION_SOURCES_TABLE } from "./table-name";
import type { KeptSource } from "./types";

export const nextlyTranslationSourcesMysql = mysqlTable(
  TRANSLATION_SOURCES_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // "collection" or "single".
    scopeKind: varchar("scope_kind", { length: 16 })
      .$type<ProvenanceScopeKind>()
      .notNull(),
    // The collection's or Single's slug.
    scopeSlug: varchar("scope_slug", { length: 191 }).notNull(),
    // The document's id.
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    // The language the text is in.
    sourceLocale: varchar("source_locale", { length: 35 }).notNull(),
    // The field's path, as provenance names it. The unique index over the six
    // key columns stays inside MySQL's 3072-byte key limit with 64 bytes to
    // spare: (16 + 191 + 191 + 35 + 255 + 64) characters at four bytes each, so
    // none of them may grow.
    fieldPath: varchar("field_path", {
      length: TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
    }).notNull(),
    // A sha256 of the value kept, in hex, which a translation's record names it by.
    fingerprint: varchar("fingerprint", {
      length: TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH,
    }).notNull(),
    // The value, wrapped: an empty value reads back as itself on every
    // database, and is never taken for one that was not kept.
    content: json("content").$type<KeptSource>().notNull(),
    // When the text was kept.
    recordedAt: datetime("recorded_at", { fsp: 3 }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(TRANSLATION_SOURCES_INDEXES, table)
);
