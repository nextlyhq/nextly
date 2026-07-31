/**
 * The empty page document, in one place.
 *
 * Several paths need a starting value for a blocks field that has no declared
 * default: a single auto-created on first read, a required column added to an
 * existing table, and the admin's create form. The generic `{}` every other
 * JSON-backed type falls back to is not a document — it carries no
 * `formatVersion`, `kind`, or `nodes` — so a field seeded with it would hold a
 * value its own validator rejects.
 *
 * @module collections/fields/blocks-document
 */

import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";

/** What a field holds when it says nothing about which kinds it accepts. */
const DEFAULT_KIND: DocumentKind = "page";

/**
 * An empty document of a kind the field accepts.
 *
 * The kind matters: a field declaring `kinds: ["template"]` would reject a
 * `page` document, so seeding one would put a value in the field that its own
 * policy forbids. When the field accepts several kinds, `page` wins if it is
 * among them — a collection field almost always means its entry's own page —
 * and otherwise the first accepted kind is used.
 */
export function emptyBlockDocument(
  kinds?: readonly DocumentKind[]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: pickKind(kinds),
    nodes: [],
  };
}

/** The same document, serialized for the paths that store JSON as text. */
export function emptyBlockDocumentJson(
  kinds?: readonly DocumentKind[]
): string {
  return JSON.stringify(emptyBlockDocument(kinds));
}

function pickKind(kinds?: readonly DocumentKind[]): DocumentKind {
  // Omitting `kinds` means the field takes a page. An empty list means it
  // accepts nothing, which no document can satisfy — the validator reads it
  // that way, so seeding a page here would hand back a value the same field
  // rejects. The page is still returned as the only sane placeholder, and the
  // field's own validation is what surfaces the contradiction.
  if (!kinds || kinds.length === 0) return DEFAULT_KIND;
  return kinds.includes(DEFAULT_KIND) ? DEFAULT_KIND : kinds[0];
}
