/**
 * The read benchmark's site: authors, and articles that each carry the fields
 * a translated site translates (a title, an excerpt, a rich-text body and a
 * card component's text) beside fields it shares (a count, a date, a flag and
 * the author). Every value comes from a seeded random source, so two runs, or
 * two machines, read the same content.
 *
 * Three storage modes are built from one definition:
 *   - `main`: a single-language site as Nextly stores one today, every field on
 *     the main table.
 *   - `per-language`: the same site with its translatable fields stored per
 *     language from the start, in the translation table, for its one language:
 *     a one-language `localization` block and the entities marked translatable.
 *   - `e4`: the same site with no `localization` block and nothing marked
 *     translatable, booted with the site-wide storage choice that stores every
 *     translatable field per language from the start for the site's one
 *     implicit language: `experimental.perLanguageStorage` in a config, which
 *     the test harness takes as its `perLanguageStorage` option. A build
 *     without that option stores this site as `main` does, and the
 *     measurement's storage check refuses to time it.
 */
import { pick } from "./stats.mjs";

export const MODES = ["main", "per-language", "e4"];

/** The site's one language in `per-language` mode. */
const LANGUAGE = "en";

/** Readable by anyone, so the REST reads need no key, as a public site's do. */
const publicRead = { read: () => true };

/**
 * The collections, component, localization and storage option for a storage
 * mode, as the test harness takes them, built with `config`: the builders
 * `nextly/config` exports, handed in by the caller so this module loads
 * without a build of Nextly.
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
    // Every translatable field per language, chosen for the whole site at boot: the harness's
    // option for what a config spells `experimental.perLanguageStorage`.
    ...(mode === "e4" ? { perLanguageStorage: true } : {}),
  };
}

/** The kinds of field a site translates, and the type a read returns each as. */
const TRANSLATABLE_KINDS = { text: "string", textarea: "string", richText: "object" };

/**
 * The `nextly/config` builders `siteFor` uses, standing in for them so that
 * the site's definition can be read here: each returns what it was given,
 * tagged with its kind.
 */
const DESCRIBING = Object.fromEntries(
  ["defineCollection", "defineFieldGroup", "checkbox", "date", "fieldGroup", "number", "relationship", "richText", "text", "textarea"].map(name => [
    name,
    input => ({ kind: name, ...input }),
  ])
);

/** A collection's or component's translatable fields, by name, with the type a read returns each as. */
function translatableFieldsIn(fields) {
  return Object.fromEntries(fields.filter(field => field.kind in TRANSLATABLE_KINDS).map(field => [field.name, TRANSLATABLE_KINDS[field.kind]]));
}

/** Each table of `site` that holds translatable fields: its collections' and its components'. */
function tablesOf(site) {
  return [
    ...site.collections.map(collection => ({ table: `dc_${collection.slug}`, entity: collection })),
    ...site.fieldGroups.map(group => ({ table: `comp_${group.slug}`, entity: group })),
  ].filter(({ entity }) => Object.keys(translatableFieldsIn(entity.fields)).length > 0);
}

/**
 * The site's translatable fields, by the table they belong to, each with the
 * type a read returns it as: the articles', the card component's and the
 * authors'. Read off the site's own definition, so every check made of them,
 * where they are stored and whether a read returned them, covers every one.
 */
export const TRANSLATABLE_FIELDS = Object.fromEntries(
  tablesOf(siteFor("main", DESCRIBING)).map(({ table, entity }) => [table, translatableFieldsIn(entity.fields)])
);

/**
 * How a mode's site stores every table with translatable fields: those
 * fields' columns, and whether they are kept per language. Read off the
 * site's definition: per language when the site stores every translatable
 * field so (`e4`'s site-wide option) or the entity is marked translatable
 * (`per-language`'s articles and card), and otherwise on the table itself, as
 * every one is in `main`. The storage check holds every table to it, both
 * ways, so a table moved that should stay is refused as surely as one left
 * that should move.
 */
export function storageContractOf(mode) {
  const site = siteFor(mode, DESCRIBING);
  return Object.fromEntries(
    tablesOf(site).map(({ table, entity }) => [
      table,
      { columns: Object.keys(TRANSLATABLE_FIELDS[table]), perLanguage: site.perLanguageStorage === true || entity.localized === true },
    ])
  );
}

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
