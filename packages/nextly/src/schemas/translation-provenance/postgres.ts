/**
 * `nextly_translation_provenance` on PostgreSQL: where each translated value came from.
 *
 * One row is one field of one language of one document, live or in the
 * language's working draft. It keeps a fingerprint of the value, its origin,
 * and for a value made from another language, that language and the
 * fingerprint of its value then: a value is out of date when its source's
 * fingerprint has moved on. A document with no row has an unknown origin.
 *
 * @module schemas/translation-provenance/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
  pgIndexes,
  TRANSLATION_PROVENANCE_INDEXES,
} from "../_internal/core-indexes";

import { TRANSLATION_PROVENANCE_TABLE } from "./table-name";
import type {
  ProvenanceOrigin,
  ProvenancePartState,
  ProvenanceScopeKind,
} from "./types";

export const nextlyTranslationProvenancePg = pgTable(
  TRANSLATION_PROVENANCE_TABLE,
  {
    id: text("id").primaryKey(),
    // "collection" or "single".
    scopeKind: text("scope_kind").$type<ProvenanceScopeKind>().notNull(),
    // The collection's or Single's slug.
    scopeSlug: text("scope_slug").notNull(),
    // The document's id.
    entryId: text("entry_id").notNull(),
    // The language the value is in.
    locale: text("locale").notNull(),
    // "live", or "draft" for the language's working draft.
    partState: text("part_state").$type<ProvenancePartState>().notNull(),
    // The field's name, with the groups, repeaters and field groups it sits in
    // before it, joined by dots.
    fieldPath: text("field_path").notNull(),
    // A sha256 of the value as it is stored now.
    valueFingerprint: text("value_fingerprint").notNull(),
    // Where the value came from.
    origin: text("origin").$type<ProvenanceOrigin>().notNull(),
    // The machine translation engine, for a value one made.
    engine: text("engine"),
    // Who wrote the value: the kind and id of the actor, when one was known.
    actorKind: text("actor_kind"),
    actorId: text("actor_id"),
    // The language the value was made from, and the fingerprint of that
    // language's value then. NULL for a value written in its own language.
    sourceLocale: text("source_locale"),
    sourceFingerprint: text("source_fingerprint"),
    // For a row of a structure kept per language, the row it was made from.
    originRowId: text("origin_row_id"),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => pgIndexes(TRANSLATION_PROVENANCE_INDEXES, table)
);
