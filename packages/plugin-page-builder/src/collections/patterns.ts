/**
 * Saved starting points an author inserts and then owns.
 *
 * A pattern is copied on insert and keeps no link back, which is the whole
 * difference between this collection and `components`. Two nouns rather than
 * one with a sync flag, because copy-versus-linked is the most consequential
 * behavioural difference in the system and a reader has to be able to tell
 * which one they are placing before they place it.
 *
 * ## Why the metadata are ordinary fields
 *
 * Everything except the document itself is a column: title, slug, description,
 * category, keywords, granularity. They are queried — the browser filters and
 * searches on them, and the generated manifest reports them — and a value that
 * is queried is a field. The tree is the one thing that is designed rather than
 * queried, so it is the one thing in the blocks field.
 *
 * ## `kinds` is what stops a page being stored here
 *
 * The blocks field accepts every document kind its `kinds` option lists, and
 * defaults to `["page"]`. Naming `"pattern"` here is not decoration: the
 * field's validator refuses a document whose kind is outside the list, so a
 * page document written to this collection is rejected at the field rather
 * than accepted and misread later by a reader that assumed the kind.
 *
 * @module collections/patterns
 */
import { defineCollection, select, text, textarea } from "nextly/config";

import { blocks } from "../fields/blocksHelper";

/** The slug patterns are stored under. */
export const PATTERNS_SLUG = "patterns";

/**
 * How much of a page one pattern covers.
 *
 * A closed set rather than free text, because it is a FACET: the browser
 * filters on it and a full-page pattern is offered as a way to start a page
 * rather than as something to insert into one. Free text would put the two
 * behaviours behind a string nobody spells the same way twice.
 */
export const PATTERN_GRANULARITIES = [
  "element",
  "group",
  "section",
  "page",
] as const;

/**
 * The plugin-owned `patterns` collection.
 *
 * Takes no options. A pattern has no address on the site — it is never served,
 * only inserted — so there is no preview path to declare and nothing for a host
 * to configure.
 */
export function patternsCollection() {
  return defineCollection({
    slug: PATTERNS_SLUG,
    labels: { singular: "Pattern", plural: "Patterns" },
    fields: [
      text({ name: "title", required: true }),
      // Unique, so two patterns cannot answer to one name. Uniqueness is
      // per collection: patterns and components are separate tables, so a
      // component may share a slug with a pattern without either being
      // ambiguous, since nothing resolves a slug without knowing which of the
      // two it is asking about.
      text({ name: "slug", required: true, unique: true }),
      // What the browser shows under the title, and what an agent reads to
      // choose between patterns. Required by neither, because a pattern saved
      // from a selection mid-edit is worth keeping before it is worth
      // describing.
      textarea({ name: "description" }),
      // Free text rather than a closed list: the useful groupings are a
      // property of the site being built, not of the page builder, and a
      // closed vocabulary here would be one no site's content fits.
      text({ name: "category" }),
      // Search terms the title does not carry — the words an author would type
      // looking for this, separated however they like. Held as one string
      // because it is matched, never enumerated.
      text({ name: "keywords" }),
      // Required, and given no default. The browser reads this to decide
      // whether a pattern is offered as something to INSERT or as a way to
      // START a page, so a row without one cannot be placed anywhere — and
      // nothing downstream can tell an author who has not answered yet from
      // one whose answer happens to be the default. A default would make the
      // form completable without a decision and file the mistakes silently;
      // requiring it costs one click and the answer is always known to
      // whoever saved the pattern.
      select({
        name: "granularity",
        required: true,
        options: PATTERN_GRANULARITIES.map(value => ({
          label: value,
          value,
        })),
      }),
      blocks({
        name: "content",
        label: "Pattern",
        blocks: { kinds: ["pattern"] },
      }),
    ],
    // Published is what makes a pattern OFFERED. A draft pattern is one being
    // worked on, and it stays out of the insert panel until it is published,
    // so the library never offers a half-built starting point.
    status: true,
    versions: { drafts: true },
    admin: { useAsTitle: "title" },
  });
}
