/**
 * What each level of the order holds for one page a route resolved: the
 * page's own `seo` group, what the route's code and its design supplied, the
 * content type's pattern, the page's content, the site's defaults, and the
 * page's declared public address in its language.
 *
 * @module resolver/page-levels
 */
import {
  NextlyError,
  languageAddressOf,
  listPageNumber,
  listPageOf,
  publicAddressOf,
  type PageMetadataImage,
  type PageMetadataInput,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { addressHolders } from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { typedPageLevel } from "../tab/typed";

import type { Levels } from "./order";

/**
 * The site's own SEO rules: its name and defaults, and each content type's
 * pattern, keyed by the collection slug or `single:<slug>`. Read from the
 * SEO settings; empty where none are set.
 */
export interface SiteRules {
  siteName?: string;
  /** Where the site itself is served: bare origins, such as `https://example.com`. */
  productionAddresses?: readonly string[];
  description?: string;
  image?: PageMetadataImage;
  patterns: Record<string, { title?: string; description?: string }>;
  /**
   * The content types hidden from search as a whole, keyed as `patterns`
   * are: every page of one is served `noindex` and left out of the sitemap.
   */
  hiddenTypes?: readonly string[];
}

/** No rules set: every value comes from the page, its route or its content. */
export const NO_RULES: SiteRules = { patterns: {} };

/**
 * The fields a page's content offers a value from, in the order they are
 * looked at, until the SEO settings map a type's fields.
 */
const CONTENT_FIELDS = {
  title: ["title", "name", "heading"],
  description: ["excerpt", "summary", "description", "subtitle"],
  image: ["coverImage", "cover", "featuredImage", "heroImage", "image"],
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** `values` without the keys whose value is undefined. */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/** The type a page belongs to, and its key in the SEO settings. */
function typeOf(input: PageMetadataInput): {
  type: PublicAddressType;
  key: string;
  document: Readonly<Record<string, unknown>>;
} {
  const { source } = input;
  return source.kind === "entry"
    ? {
        type: { kind: "collection", slug: source.collection },
        key: source.collection,
        document: source.entry,
      }
    : {
        type: { kind: "single", slug: source.slug },
        key: `single:${source.slug}`,
        document: source.document,
      };
}

/** The media document a value names: itself where populated, else read. */
async function mediaOf(ctx: PluginContext, value: unknown): Promise<unknown> {
  if (typeof value !== "string" || value === "") return value;
  try {
    return await ctx.services.media.findById(value, {});
  } catch (error) {
    // A missing image is no image: the next level supplies one. Any other
    // failure is thrown, so the page's head is not answered, and cached,
    // without an image it has.
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
}

/** A media document as a share image; nothing without an address to load. */
function asImage(media: unknown): PageMetadataImage | undefined {
  if (!isRecord(media)) return undefined;
  const url = textOf(media.url);
  if (url === undefined) return undefined;
  return defined({
    url,
    width: typeof media.width === "number" ? media.width : undefined,
    height: typeof media.height === "number" ? media.height : undefined,
    alt: textOf(media.altText) ?? textOf(media.alt),
  }) as PageMetadataImage;
}

/**
 * A media value as a share image: a populated media document, or an id
 * looked up as the system.
 */
export async function imageOf(
  ctx: PluginContext,
  value: unknown
): Promise<PageMetadataImage | undefined> {
  return asImage(await mediaOf(ctx, value));
}

/** A token's name as matched: letters and digits only, any case. */
const tokenKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * `pattern` filled in from the page: `{Title}` and `{Site name}`, and any of
 * the page's own text fields by name. Nothing where a token has no value, so
 * the next level supplies the value rather than a pattern with a hole in it.
 */
export function fillPattern(
  pattern: string,
  values: { title?: string; siteName?: string },
  document: Readonly<Record<string, unknown>>
): string | undefined {
  const fields = new Map(
    Object.entries(document).map(([name, value]) => [tokenKey(name), value])
  );
  let missing = false;
  const filled = pattern.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const key = tokenKey(name);
    const value =
      key === "title"
        ? values.title
        : key === "sitename"
          ? values.siteName
          : (textOf(fields.get(key)) ??
            (typeof fields.get(key) === "number"
              ? String(fields.get(key))
              : undefined));
    if (value === undefined) missing = true;
    return value ?? "";
  });
  return missing ? undefined : textOf(filled.trim());
}

/** The first of `names` the document has a value for, and which. */
function firstField(
  document: Readonly<Record<string, unknown>>,
  names: readonly string[],
  has: (value: unknown) => boolean
): { field: string; value: unknown } | undefined {
  for (const field of names) {
    if (has(document[field])) return { field, value: document[field] };
  }
  return undefined;
}

/**
 * The page's own public address in its language: as the site's language
 * rule forms it where the route read it in one, root-relative or on the
 * language's own domain. None where its type declares no address.
 */
export async function addressOf(
  ctx: PluginContext,
  page: { type: PublicAddressType; key: string },
  document: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  served: string | undefined
): Promise<string | undefined> {
  const address = await publicAddressOf(page.type, document, locale);
  if (address.status !== "resolved") return undefined;
  // An address another page holds is that page's: this one lost it in a
  // clash and has no canonical until it is given a new address.
  if (await heldByAnother(ctx, page.key, document, address.path, locale)) {
    return undefined;
  }
  let origin = "";
  let path = address.path;
  if (locale !== undefined) {
    const inLanguage = await languageAddressOf(address.path, locale);
    if (inLanguage.status !== "resolved") return undefined;
    origin = inLanguage.origin ?? "";
    path = inLanguage.path;
  }
  return `${origin}${laterListPage(path, served) ?? path}`;
}

/** Whether the record says a page other than this one holds `path`. */
async function heldByAnother(
  ctx: PluginContext,
  key: string,
  document: Readonly<Record<string, unknown>>,
  path: string,
  locale: string | undefined
): Promise<boolean> {
  const holders = await addressHolders(ctx, path, locale);
  // An id is text or a number; anything else names no record.
  const id =
    typeof document.id === "string" || typeof document.id === "number"
      ? String(document.id)
      : "";
  return (
    holders.length > 0 &&
    !holders.some(holder => holder.collection === key && holder.id === id)
  );
}

/**
 * The address `served` names where it is a later page of the list at `path`
 * (`/news/page/2` of `/news`), so each page of a list is its own page to
 * search engines; nothing for page 1 under a second spelling, a page number
 * spelled another way, or a page of another address.
 */
function laterListPage(
  path: string,
  served: string | undefined
): string | undefined {
  if (served === undefined) return undefined;
  const later = listPageOf(served.replace(/^\/+/, ""));
  if (later === null) return undefined;
  const page = listPageNumber(later.segment);
  if (page === null || page < 2) return undefined;
  return `/${later.base}` === path || (later.base === "" && path === "/")
    ? served
    : undefined;
}

/**
 * What a person typed in the page's `seo` group, read by the same function
 * the SEO tab reads it with, so the tab's preview and the page's head take
 * the group alike; only the share image, stored as an id, is looked up here.
 */
async function pageLevel(
  ctx: PluginContext,
  seo: Readonly<Record<string, unknown>>
): Promise<Levels["page"]> {
  return typedPageLevel(seo, await imageOf(ctx, seo.ogImage));
}

/** A text value from the first of `names` the page has one in. */
function textFrom(
  document: Readonly<Record<string, unknown>>,
  names: readonly string[]
): { value: string; field: string } | undefined {
  const found = firstField(document, names, v => textOf(v) !== undefined);
  return found && { value: String(found.value), field: found.field };
}

/** What the page's own content offers. */
async function contentLevel(
  ctx: PluginContext,
  document: Readonly<Record<string, unknown>>,
  needImage: boolean
): Promise<Levels["content"]> {
  return defined({
    title: textFrom(document, CONTENT_FIELDS.title),
    description: textFrom(document, CONTENT_FIELDS.description),
    image: needImage ? await contentImage(ctx, document) : undefined,
  });
}

/**
 * The first of the page's image fields that names an image there is: a field
 * naming one that is gone gives way to the next. A lookup failing for any
 * other reason is thrown, as every image lookup is.
 */
async function contentImage(
  ctx: PluginContext,
  document: Readonly<Record<string, unknown>>
): Promise<{ value: PageMetadataImage; field: string } | undefined> {
  for (const field of CONTENT_FIELDS.image) {
    const value = document[field];
    if (value === null || value === undefined || value === "") continue;
    const image = await imageOf(ctx, value);
    if (image !== undefined) return { value: image, field };
  }
  return undefined;
}

/** Whether a level's image has an address to load it from. */
const hasImage = (image: PageMetadataImage | undefined) =>
  textOf(image?.url) !== undefined;

/** The content type's patterns, filled in from the page. */
function patternLevel(
  patterns: { title?: string; description?: string },
  values: { title?: string; siteName?: string },
  document: Readonly<Record<string, unknown>>
): Levels["pattern"] {
  const fill = (pattern: string | undefined) => {
    const value =
      pattern === undefined
        ? undefined
        : fillPattern(pattern, values, document);
    return value === undefined || pattern === undefined
      ? undefined
      : { value, pattern };
  };
  return defined({
    title: fill(patterns.title),
    description: fill(patterns.description),
  });
}

/** What every level holds for the page `input` names. */
export async function levelsOf(
  ctx: PluginContext,
  input: PageMetadataInput,
  rules: SiteRules
): Promise<Levels> {
  const { type, key, document } = typeOf(input);
  const seo = isRecord(document.seo) ? document.seo : {};
  // Looked up in the order of who wins, the page's own image first: an image
  // a lower level would offer is not looked up once a higher one has one, so
  // a lookup that would fail never costs the page an answer it has.
  const page = await pageLevel(ctx, seo);
  const higherImage =
    hasImage(page.image) ||
    hasImage(input.code.image) ||
    hasImage(input.derived.image);
  const content = await contentLevel(ctx, document, !higherImage);
  const address = await addressOf(
    ctx,
    { type, key },
    document,
    input.locale,
    input.path
  );
  return {
    page,
    code: input.code,
    template: input.derived,
    pattern: patternLevel(
      rules.patterns[key] ?? {},
      defined({ title: content.title?.value, siteName: rules.siteName }),
      document
    ),
    content,
    site: defined({
      title: rules.siteName,
      description: rules.description,
      image: rules.image,
      // The environment's addresses win over the settings', as the staging
      // guard reads them, so the two never disagree about the site's own.
      productionAddresses: productionAddressesOf(rules.productionAddresses),
    }),
    ...(address === undefined ? {} : { address }),
    ...(rules.hiddenTypes?.includes(key) === true ? { typeHidden: true } : {}),
  };
}
