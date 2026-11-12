/**
 * Reading a WordPress export file (Tools › Export, the WXR format) for the
 * values Yoast SEO or Rank Math keep with each post and page.
 *
 * WordPress writes the file in one regular shape: an `<item>` per post, its
 * address in `<link>`, its slug in `<wp:post_name>`, and each stored value
 * as a `<wp:postmeta>` pair. It is read by that shape rather than by a full
 * XML parser, which the plugin does not carry; anything else in the file is
 * passed over. Attachments, menu items, revisions and posts in the bin are
 * not pages, and are not read. Pure.
 *
 * @module import/wordpress
 */
import type { ImportTarget } from "./contract";
import {
  ImportFileRefused,
  pathOfAddress,
  textValue,
  type ImportedRecord,
  type ImportedValues,
  type ParsedSource,
  type Variables,
} from "./records";

/** The XML entities WordPress writes, and any written by number. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (entity: string, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      }
      if (lower.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      }
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      return named[lower] ?? entity;
    }
  );
}

/** An element's text: its CDATA sections as written, the rest decoded. */
function elementText(inner: string): string {
  let text = "";
  let rest = inner;
  for (;;) {
    const start = rest.indexOf("<![CDATA[");
    if (start === -1) return text + decodeEntities(rest);
    const end = rest.indexOf("]]>", start + 9);
    if (end === -1) return text + decodeEntities(rest);
    text += decodeEntities(rest.slice(0, start)) + rest.slice(start + 9, end);
    rest = rest.slice(end + 3);
  }
}

/** The text of the first `<tag>` in `xml`, or none. */
function first(xml: string, tag: string): string | undefined {
  const [found] = blocks(xml, tag, 1);
  return found === undefined ? undefined : elementText(found);
}

/**
 * `xml` with the inside of every CDATA section blanked, at the same length:
 * where its tags are, so a post's own content, which may hold text such as
 * `</item>`, never ends or starts an element of the export.
 */
function structureOf(xml: string): string {
  return xml.replace(
    /<!\[CDATA\[[\s\S]*?\]\]>/g,
    section => `<![CDATA[${" ".repeat(section.length - 12)}]]>`
  );
}

/**
 * The blocks between `<tag>` and `</tag>` in `xml`, at most `limit`: found
 * in its structure, outside every CDATA section, and read from `xml` itself.
 */
function blocks(xml: string, tag: string, limit = Infinity): string[] {
  const structure = structureOf(xml);
  const found: string[] = [];
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
  for (
    let match = open.exec(structure);
    match !== null && found.length < limit;
    match = open.exec(structure)
  ) {
    const from = match.index + match[0].length;
    const close = structure.indexOf(`</${tag}>`, from);
    if (close === -1) break;
    found.push(xml.slice(from, close));
    open.lastIndex = close;
  }
  return found;
}

/** One post of the file: what identifies it, and its stored values. */
interface WordPressItem {
  title?: string;
  link?: string;
  slug?: string;
  type?: string;
  status?: string;
  meta: Map<string, string>;
}

/** Post types that are not pages of the site. */
const NOT_PAGES = new Set([
  "attachment",
  "nav_menu_item",
  "revision",
  "custom_css",
  "customize_changeset",
  "oembed_cache",
  "user_request",
  "wp_block",
  "wp_template",
  "wp_template_part",
  "wp_global_styles",
  "wp_navigation",
  "wp_font_family",
  "wp_font_face",
]);

/** Statuses of posts that are not pages of the site. */
const NOT_LIVE = new Set(["trash", "auto-draft", "inherit"]);

/** Every stored value of one post, by key. */
function metaOf(item: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const pair of blocks(item, "wp:postmeta")) {
    const key = first(pair, "wp:meta_key");
    const value = first(pair, "wp:meta_value");
    if (key !== undefined && value !== undefined) meta.set(key, value);
  }
  return meta;
}

/** One `<item>` as a post, or none where it is not a page of the site. */
function itemOf(item: string): WordPressItem | undefined {
  const type = textValue(first(item, "wp:post_type"));
  const status = textValue(first(item, "wp:status"));
  if (type !== undefined && NOT_PAGES.has(type)) return undefined;
  if (status !== undefined && NOT_LIVE.has(status)) return undefined;
  const title = textValue(first(item, "title"));
  const link = textValue(first(item, "link"));
  const slug = textValue(first(item, "wp:post_name"));
  return {
    ...(title === undefined ? {} : { title }),
    ...(link === undefined ? {} : { link }),
    ...(slug === undefined ? {} : { slug }),
    ...(type === undefined ? {} : { type }),
    ...(status === undefined ? {} : { status }),
    meta: metaOf(item),
  };
}

/** Every post and page the export holds, or a refusal where it is not one. */
export function wordPressItems(xml: string): WordPressItem[] {
  if (!/<rss[\s>]/i.test(xml) || !/xmlns:wp=/i.test(xml)) {
    throw new ImportFileRefused(
      "This isn't a WordPress export. Make one in WordPress under Tools › Export, with All content chosen.",
      "seo-import-not-wordpress"
    );
  }
  return blocks(xml, "item").flatMap(item => itemOf(item) ?? []);
}

/** A stored value read for one place, and what the plugin calls it. */
interface MetaField {
  key: string;
  label: string;
  target: Exclude<ImportTarget, "shown" | "skip">;
}

/** What each plugin keeps, where it goes, and what it calls it. */
interface PluginKeys {
  variables: Variables;
  /** The prefix every one of the plugin's keys starts with. */
  prefix: string;
  fields: MetaField[];
  /** Keys read for visibility, apart from the fields. */
  robots: { key: string; label: string };
  /** What the plugin calls the keys it keeps that are left out. */
  leftNames: Record<string, string>;
}

const YOAST: PluginKeys = {
  variables: "yoast",
  prefix: "_yoast_wpseo_",
  fields: [
    { key: "_yoast_wpseo_title", label: "SEO title", target: "title" },
    {
      key: "_yoast_wpseo_metadesc",
      label: "Meta description",
      target: "description",
    },
    {
      key: "_yoast_wpseo_opengraph-image",
      label: "Facebook image",
      target: "image",
    },
    {
      key: "_yoast_wpseo_opengraph-title",
      label: "Facebook title",
      target: "socialTitle",
    },
    {
      key: "_yoast_wpseo_opengraph-description",
      label: "Facebook description",
      target: "socialDescription",
    },
    {
      key: "_yoast_wpseo_canonical",
      label: "Canonical URL",
      target: "canonical",
    },
  ],
  robots: { key: "_yoast_wpseo_meta-robots-noindex", label: "noindex" },
  leftNames: {
    _yoast_wpseo_focuskw: "focus keyphrase",
    _yoast_wpseo_is_cornerstone: "cornerstone flag",
    "_yoast_wpseo_twitter-title": "X title",
    "_yoast_wpseo_twitter-description": "X description",
    "_yoast_wpseo_twitter-image": "X image",
    "_yoast_wpseo_meta-robots-nofollow": "nofollow",
    _yoast_wpseo_bctitle: "breadcrumb title",
  },
};

const RANK_MATH: PluginKeys = {
  variables: "rankMath",
  prefix: "rank_math_",
  fields: [
    { key: "rank_math_title", label: "SEO title", target: "title" },
    {
      key: "rank_math_description",
      label: "Description",
      target: "description",
    },
    {
      key: "rank_math_facebook_image",
      label: "Facebook image",
      target: "image",
    },
    {
      key: "rank_math_facebook_title",
      label: "Facebook title",
      target: "socialTitle",
    },
    {
      key: "rank_math_facebook_description",
      label: "Facebook description",
      target: "socialDescription",
    },
    {
      key: "rank_math_canonical_url",
      label: "Canonical URL",
      target: "canonical",
    },
  ],
  robots: { key: "rank_math_robots", label: "Robots: noindex" },
  leftNames: {
    rank_math_focus_keyword: "focus keyword",
    rank_math_seo_score: "SEO score",
    rank_math_pillar_content: "pillar content",
    rank_math_twitter_title: "X title",
    rank_math_twitter_description: "X description",
    rank_math_primary_category: "primary category",
    rank_math_advanced_robots: "advanced robots",
    rank_math_schema_Article: "schema",
  },
};

/** Keys a plugin keeps for itself that say nothing about a page's SEO. */
function bookkeeping(key: string): boolean {
  return /(_id|_score|_linkdex|_content_score|_estimated-reading-time-minutes|_wordproof_timestamp|_internal_links_processed|_analytic_object_id)$/i.test(
    key
  );
}

/**
 * Whether a page is hidden from search, as the plugin keeps it: Yoast's
 * `1` hides it and `2` shows it; Rank Math lists `noindex` or `index` among
 * a page's robots words, in a PHP array.
 */
function hiddenOf(keys: PluginKeys, value: string): boolean | undefined {
  if (keys === YOAST) {
    if (value.trim() === "1") return true;
    if (value.trim() === "2") return false;
    return undefined;
  }
  if (/"noindex"/.test(value) || /^\s*noindex\b/.test(value)) return true;
  if (/"index"/.test(value) || /^\s*index\b/.test(value)) return false;
  return undefined;
}

/**
 * The address WordPress gave a post, or none where it gave only its id:
 * a draft's link is `/?p=12`, which names no address here.
 */
function addressOfItem(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  try {
    const url = new URL(link, "https://example.invalid");
    if (url.searchParams.has("p") || url.searchParams.has("page_id")) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return pathOfAddress(link);
}

/** The values one plugin keeps for one post. */
function valuesOf(keys: PluginKeys, item: WordPressItem): ImportedValues {
  const values: ImportedValues = {};
  for (const field of keys.fields) {
    const value = textValue(item.meta.get(field.key));
    if (value === undefined) continue;
    if (field.target === "image") values.image = { url: value };
    else if (field.target !== "hidden") values[field.target] = value;
  }
  const robots = item.meta.get(keys.robots.key);
  const hidden = robots === undefined ? undefined : hiddenOf(keys, robots);
  if (hidden !== undefined) values.hidden = hidden;
  return values;
}

/** The plugin's keys a post holds that the import leaves out, by name. */
function leftOf(keys: PluginKeys, item: WordPressItem): string[] {
  const read = new Set([
    ...keys.fields.map(field => field.key),
    keys.robots.key,
  ]);
  return [...item.meta]
    .filter(
      ([key, value]) =>
        key.startsWith(keys.prefix) &&
        !read.has(key) &&
        textValue(value) !== undefined &&
        !bookkeeping(key)
    )
    .map(([key]) => keys.leftNames[key] ?? key);
}

/** Note what the plugin called each place `values` fills. */
function noteFrom(
  keys: PluginKeys,
  values: ImportedValues,
  from: ParsedSource["from"]
): void {
  for (const field of keys.fields) {
    if (values[field.target] === undefined) continue;
    const names = (from[field.target] ??= []);
    if (!names.includes(field.label)) names.push(field.label);
  }
  if (values.hidden !== undefined) from.hidden = [keys.robots.label];
}

/** One post as a record. */
function recordOf(
  keys: PluginKeys,
  item: WordPressItem,
  values: ImportedValues
): ImportedRecord {
  const path = addressOfItem(item.link);
  return {
    label: item.title ?? path ?? item.slug ?? "Untitled",
    match: {
      ...(path === undefined ? {} : { path }),
      ...(item.slug === undefined ? {} : { slug: item.slug }),
    },
    values,
    variables: keys.variables,
    ...(item.title === undefined ? {} : { sourceTitle: item.title }),
  };
}

/** The values Yoast or Rank Math keep in a WordPress export. */
function readPlugin(xml: string, keys: PluginKeys): ParsedSource {
  const records: ImportedRecord[] = [];
  const left = new Set<string>();
  const from: ParsedSource["from"] = {};
  for (const item of wordPressItems(xml)) {
    for (const name of leftOf(keys, item)) left.add(name);
    const values = valuesOf(keys, item);
    noteFrom(keys, values, from);
    records.push(recordOf(keys, item, values));
  }
  return { records, from, left: [...left], warnings: [] };
}

/** Yoast SEO's values from a WordPress export. */
export function readYoast(xml: string): ParsedSource {
  return readPlugin(xml, YOAST);
}

/** Rank Math's values from a WordPress export. */
export function readRankMathExport(xml: string): ParsedSource {
  return readPlugin(xml, RANK_MATH);
}
