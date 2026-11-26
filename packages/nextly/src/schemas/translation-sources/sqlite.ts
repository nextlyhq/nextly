/**
 * `nextly_translation_sources` on SQLite: the source text each translation was made from.
 *
 * One row is one version of one field's value in the language other languages
 * were translated from, kept for as long as a translation made from it is
 * recorded. Every translation made from that version shares the row: it is
 * found by the columns its provenance names its source by (`source_locale`,
 * `field_path` and `source_fingerprint`), so no row of either table points at
 * the other.
 *
 * @module schemas/translation-sources/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  sqliteIndexes,
  TRANSLATION_SOURCES_INDEXES,
} from "../_internal/core-indexes-sqlite";
import type { ProvenanceScopeKind } from "../translation-provenance/types";

import { TRANSLATION_SOURCES_TABLE } from "./table-name";
import type { KeptSource } from "./types";

export const nextlyTranslationSourcesSqlite = sqliteTable(
  TRANSLATION_SOURCES_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // "collection" or "single".
    scopeKind: text("scope_kind").$type<ProvenanceScopeKind>().notNull(),
    // The collection's or Single's slug.
    scopeSlug: text("scope_slug").notNull(),
    // The document's id.
    entryId: text("entry_id").notNull(),
    // The language the text is in.
    sourceLocale: text("source_locale").notNull(),
    // The field's path, as provenance names it.
    fieldPath: text("field_path").notNull(),
    // A sha256 of the value kept, which a translation's record names it by.
    fingerprint: text("fingerprint").notNull(),
    // The value, wrapped: an empty value reads back as itself on every
    // database, and is never taken for one that was not kept.
    content: text("content", { mode: "json" }).$type<KeptSource>().notNull(),
    // When the text was kept.
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(TRANSLATION_SOURCES_INDEXES, table)
);
