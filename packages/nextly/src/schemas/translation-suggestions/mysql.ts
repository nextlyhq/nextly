/**
 * `nextly_translation_suggestions` on MySQL: the translation suggested for each text.
 *
 * One row is the one open suggestion for one text of a document in one
 * language, kept apart from the document until a person accepts it: a newer
 * suggestion for the text takes its place, and accepting or dismissing it
 * removes it. The text is named by its address, the way down to it from the
 * document's own field, and kept under a hash of that address, which is one
 * width for an address of any depth.
 *
 * @module schemas/translation-suggestions/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { datetime, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";

import {
  mysqlIndexes,
  TRANSLATION_SUGGESTIONS_INDEXES,
} from "../_internal/core-indexes";
import {
  TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
  TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH,
} from "../translation-provenance/table-name";
import type { ProvenanceScopeKind } from "../translation-provenance/types";

import {
  TRANSLATION_SUGGESTIONS_PRINCIPAL_KIND_LENGTH,
  TRANSLATION_SUGGESTIONS_TABLE,
  TRANSLATION_SUGGESTIONS_UNIT_KEY_LENGTH,
} from "./table-name";
import type { StoredSuggestionValue, SuggestionOrigin } from "./types";

export const nextlyTranslationSuggestionsMysql = mysqlTable(
  TRANSLATION_SUGGESTIONS_TABLE,
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
    // The language the text is suggested in.
    targetLocale: varchar("target_locale", { length: 35 }).notNull(),
    // The language it was made from.
    sourceLocale: varchar("source_locale", { length: 35 }).notNull(),
    // The document's own field the text is in.
    fieldPath: varchar("field_path", {
      length: TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
    }).notNull(),
    // A sha256 of the text's address, in hex. The unique index over the five
    // key columns takes 1,988 of MySQL's 3,072 key bytes: (16 + 191 + 191 +
    // 35 + 64) characters at four bytes each.
    unitKey: varchar("unit_key", {
      length: TRANSLATION_SUGGESTIONS_UNIT_KEY_LENGTH,
    }).notNull(),
    // The text's address: the list of steps from its field down to it.
    unitAddress: json("unit_address").notNull(),
    // The suggested text, wrapped as {"value": ...}: a null or a plain string
    // reads back as itself on every database.
    value: json("value").$type<StoredSuggestionValue>().notNull(),
    // Where the suggestion came from.
    origin: varchar("origin", { length: 16 })
      .$type<SuggestionOrigin>()
      .notNull(),
    // The machine translation engine and its model, for one a machine made.
    engine: varchar("engine", { length: 191 }),
    model: varchar("model", { length: 191 }),
    // A sha256 of the source text it was made from, in hex.
    sourceFingerprint: varchar("source_fingerprint", {
      length: TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH,
    }).notNull(),
    // Who submitted it: the kind and id of the actor, when one was known.
    createdByKind: varchar("created_by_kind", { length: 32 }),
    createdById: varchar("created_by_id", { length: 191 }),
    // A plugin-defined person's kind: such a person is kept by kind alone, never by id.
    createdByPrincipalKind: varchar("created_by_principal_kind", {
      length: TRANSLATION_SUGGESTIONS_PRINCIPAL_KIND_LENGTH,
    }),
    createdAt: datetime("created_at", { fsp: 3 }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(TRANSLATION_SUGGESTIONS_INDEXES, table)
);
