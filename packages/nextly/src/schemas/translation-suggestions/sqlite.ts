/**
 * `nextly_translation_suggestions` on SQLite: the translation suggested for each text.
 *
 * One row is the one open suggestion for one text of a document in one
 * language, kept apart from the document until a person accepts it: a newer
 * suggestion for the text takes its place, and accepting or dismissing it
 * removes it. The text is named by its address, the way down to it from the
 * document's own field, and kept under a hash of that address, which is one
 * width for an address of any depth.
 *
 * @module schemas/translation-suggestions/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  sqliteIndexes,
  TRANSLATION_SUGGESTIONS_INDEXES,
} from "../_internal/core-indexes";
import type { ProvenanceScopeKind } from "../translation-provenance/types";

import { TRANSLATION_SUGGESTIONS_TABLE } from "./table-name";
import type { StoredSuggestionValue, SuggestionOrigin } from "./types";

export const nextlyTranslationSuggestionsSqlite = sqliteTable(
  TRANSLATION_SUGGESTIONS_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // "collection" or "single".
    scopeKind: text("scope_kind").$type<ProvenanceScopeKind>().notNull(),
    // The collection's or Single's slug.
    scopeSlug: text("scope_slug").notNull(),
    // The document's id.
    entryId: text("entry_id").notNull(),
    // The language the text is suggested in.
    targetLocale: text("target_locale").notNull(),
    // The language it was made from.
    sourceLocale: text("source_locale").notNull(),
    // The document's own field the text is in.
    fieldPath: text("field_path").notNull(),
    // A sha256 of the text's address, in hex.
    unitKey: text("unit_key").notNull(),
    // The text's address: the list of steps from its field down to it.
    unitAddress: text("unit_address", { mode: "json" }).notNull(),
    // The suggested text, wrapped as {"value": ...}: a null or a plain string
    // reads back as itself on every database.
    value: text("value", { mode: "json" })
      .$type<StoredSuggestionValue>()
      .notNull(),
    // Where the suggestion came from.
    origin: text("origin").$type<SuggestionOrigin>().notNull(),
    // The machine translation engine and its model, for one a machine made.
    engine: text("engine"),
    model: text("model"),
    // A sha256 of the source text it was made from, in hex.
    sourceFingerprint: text("source_fingerprint").notNull(),
    // Who submitted it: the kind and id of the actor, when one was known.
    createdByKind: text("created_by_kind"),
    createdById: text("created_by_id"),
    // A plugin-defined person's kind: such a person is kept by kind alone, never by id.
    createdByPrincipalKind: text("created_by_principal_kind"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(TRANSLATION_SUGGESTIONS_INDEXES, table)
);
