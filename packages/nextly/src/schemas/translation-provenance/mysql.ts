/**
 * `nextly_translation_provenance` on MySQL: where each translated value came from.
 *
 * One row is one field of one language of one document, live or in the
 * language's working draft. It keeps a fingerprint of the value, its origin,
 * and for a value made from another language, that language and the
 * fingerprint of its value then: a value is out of date when its source's
 * fingerprint has moved on. A document with no row has an unknown origin.
 *
 * @module schemas/translation-provenance/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { datetime, mysqlTable, varchar } from "drizzle-orm/mysql-core";

import {
  mysqlIndexes,
  TRANSLATION_PROVENANCE_INDEXES,
} from "../_internal/core-indexes";

import {
  TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
  TRANSLATION_PROVENANCE_TABLE,
} from "./table-name";
import type {
  ProvenanceOrigin,
  ProvenancePartState,
  ProvenanceScopeKind,
} from "./types";

export const nextlyTranslationProvenanceMysql = mysqlTable(
  TRANSLATION_PROVENANCE_TABLE,
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
    // The language the value is in.
    locale: varchar("locale", { length: 35 }).notNull(),
    // "live", or "draft" for the language's working draft.
    partState: varchar("part_state", { length: 8 })
      .$type<ProvenancePartState>()
      .notNull(),
    // The field's name, with the groups, repeaters and field groups it sits in
    // before it, joined by dots; a longer path is stored bounded to the column,
    // ending in a hash of the whole path. The unique index over the six key
    // columns stays inside MySQL's 3072-byte key limit: (16 + 191 + 191 + 35 +
    // 8 + 255) characters at four bytes each.
    fieldPath: varchar("field_path", {
      length: TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
    }).notNull(),
    // A sha256 of the value as it is stored now, in hex.
    valueFingerprint: varchar("value_fingerprint", { length: 64 }).notNull(),
    // Where the value came from.
    origin: varchar("origin", { length: 16 })
      .$type<ProvenanceOrigin>()
      .notNull(),
    // The machine translation engine, for a value one made.
    engine: varchar("engine", { length: 191 }),
    // Who wrote the value: the kind and id of the actor, when one was known.
    actorKind: varchar("actor_kind", { length: 32 }),
    actorId: varchar("actor_id", { length: 191 }),
    // A plugin-defined person's kind: such a person is kept by kind alone, never by id.
    actorPrincipalKind: varchar("actor_principal_kind", { length: 64 }),
    // The language the value was made from, and the fingerprint of that
    // language's value then. NULL for a value written in its own language.
    sourceLocale: varchar("source_locale", { length: 35 }),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }),
    // For a row of a structure kept per language, the row it was made from.
    originRowId: varchar("origin_row_id", { length: 191 }),
    writtenAt: datetime("written_at", { fsp: 3 }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(TRANSLATION_PROVENANCE_INDEXES, table)
);
