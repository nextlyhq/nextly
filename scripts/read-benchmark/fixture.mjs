/**
 * The read benchmark's site: authors, and articles that each carry the fields
 * a translated site translates (a title, an excerpt, a rich-text body and a
 * card component's text) beside fields it shares (a count, a date, a flag and
 * the author). Every value comes from a seeded random source, so two runs, or
 * two machines, read the same content.
 *
 * Two storage modes are built from one definition:
 *   - `main`: a single-language site as Nextly stores one today, every field on
 *     the main table.
 *   - `per-language`: the same site with its translatable fields stored per
 *     language from the start, in the translation table, for its one language.
 */
import { pick } from "./stats.mjs";

export const MODES = ["main", "per-language"];

/** The site's one language in `per-language` mode. */
const LANGUAGE = "en";

/** Readable by anyone, so the REST reads need no key, as a public site's do. */
const publicRead = { read: () => true };

/**
 * The collections, component and localization for a storage mode, built with
 * `config`: the builders `nextly/config` exports, handed in by the caller so
 * this module loads without a build of Nextly.
 */
export function siteFor(mode, config) {
  if (!MODES.includes(mode)) throw new RangeError(`unknown mode ${mode}`);
  const { defineCollection, defineFieldGroup, checkbox, date, fieldGroup, number, relationship, richText, text, textarea } = config;
  const perLanguage = mode === "per-language";
  // What makes a collection or component store its translatable fields per language.
  const translatable = perLanguage ? { localized: true } : {};
  return {
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        ...translatable,
        fields: [text({ name: "heading" }), textarea({ name: "blurb" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        access: publicRead,
        fields: [text({ name: "name" }), textarea({ name: "bio" })],
      }),
      defineCollection({
        slug: "articles",
        access: publicRead,
        ...translatable,
        fields: [
          text({ name: "headline" }),
          textarea({ name: "excerpt" }),
          richText({ name: "body" }),
          number({ name: "views" }),
          date({ name: "publishedOn" }),
          checkbox({ name: "featured" }),
          relationship({ name: "author", relationTo: "authors" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
    ...(perLanguage ? { localization: { locales: [LANGUAGE], defaultLocale: LANGUAGE } } : {}),
  };
}

/**
 * The translatable columns of each table that has any: the articles' own, and
 * the card component's. A `main` site keeps them on these tables; a
 * `per-language` site moves them to each table's translation table, where
 * its shared columns never go.
 */
export const TRANSLATABLE_COLUMNS = { dc_articles: ["headline", "excerpt", "body"], comp_card: ["heading", "blurb"] };

/** The table a `per-language` site keeps `table`'s translatable values in. */
export function localesOf(table) {
  return `${table}_locales`;
}

const WORDS = (
  "content model editor publish draft release schedule language locale field " +
  "column table index query cache page site author article section heading " +
  "summary review history version media image video upload storage bucket " +
  "account access role permission token session request response server client " +
  "plugin component block layout theme design token style color spacing grid"
).split(" ");

/** `count` words from the list, joined, first one capitalised. */
function words(random, count) {
  const out = Array.from({ length: count }, () => WORDS[pick(random, WORDS.length)]);
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join(" ");
}

/**
 * A rich-text body as the editor stores one: a root of paragraphs of text
 * nodes. Six paragraphs of about seventy words, around 3 KB of JSON, the size
 * of a short article.
 */
function body(random) {
  const paragraph = () => ({
    type: "paragraph",
    format: "",
    indent: 0,
    version: 1,
    direction: "ltr",
    children: [{ type: "text", text: `${words(random, 65 + pick(random, 15))}.`, format: 0, mode: "normal", style: "", detail: 0, version: 1 }],
  });
  return { root: { type: "root", format: "", indent: 0, version: 1, direction: "ltr", children: Array.from({ length: 6 }, paragraph) } };
}

/** An author's values. */
export function authorData(random) {
  return { name: words(random, 2), bio: `${words(random, 30)}.` };
}

/** Article `i`'s values, by an author from `authorIds`. */
export function articleData(random, i, authorIds) {
  return {
    headline: words(random, 6 + pick(random, 5)),
    excerpt: `${words(random, 35 + pick(random, 15))}.`,
    body: body(random),
    views: pick(random, 100_000),
    publishedOn: new Date(Date.UTC(2025, 0, 1) + i * 3_600_000).toISOString(),
    featured: pick(random, 10) === 0,
    author: authorIds[pick(random, authorIds.length)],
    card: { heading: words(random, 4), blurb: `${words(random, 20)}.` },
  };
}
