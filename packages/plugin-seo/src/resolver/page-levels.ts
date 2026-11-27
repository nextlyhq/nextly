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
import { codePagesSlug } from "../code-pages/collection";
import { isRecord, textOf } from "../plain-values";
import type { AiCrawlerChoice } from "../settings/contract";
import { fillPattern } from "../settings/patterns";
import type { StoredRobotsRules } from "../settings/robots-rules-stored";
import { shareCardOf, type CardSource } from "../social/share-card";
import { canMakeShareImages } from "../social/share-image";
import { typedPageLevel } from "../tab/typed";

import type { Levels } from "./order";
import { ownTitleIn, titleSourcesOf, type TitleFields } from "./own-name";

/**
 * The site's own SEO rules: its name and defaults, the patterns a type uses
 * where it has none of its own, and each content type's pattern, keyed by the
 * collection slug or `single:<slug>`. Read from the SEO settings.
 */
export interface SiteRules {
  siteName?: string;
  /** Where the site itself is served: bare origins, such as `https://example.com`. */
  productionAddresses?: readonly string[];
  description?: string;
  image?: PageMetadataImage;
  /** The patterns a type uses where it has none of its own. */
  defaultPatterns?: { title?: string; description?: string };
  patterns: Record<string, { title?: string; description?: string }>;
  /**
   * The content types hidden from search as a whole, keyed as `patterns`
   * are: every page of one is served `noindex` and left out of the sitemap.
   */
  hiddenTypes?: readonly string[];
  /**
   * The content types whose SEO is switched off, keyed as `patterns` are:
   * the plugin answers nothing for their pages and lists none of them.
   */
  typesWithSeoOff?: readonly string[];
  /** What robots.txt asks AI crawlers to do, where the site has chosen. */
  aiCrawlers?: AiCrawlerChoice;
  /** Whether IndexNow is told of changed pages: only once switched on. */
  indexNow?: boolean;
  /** Whether `/llms.txt` is served: only once switched on. */
  llmsTxt?: boolean;
  /**
   * Whether `/llms-full.txt`, every listed page's words in one file, is
   * served: only once switched on, and only beside llms.txt.
   */
  llmsFullTxt?: boolean;
  /** What the site tells AI tools in its own words, at the top of llms.txt. */
  llmsIntro?: string;
  /**
   * The field each content type's pages are named from, where the site's
   * options choose one (`titleFields`): what `{Title}` stands for.
   */
  titleFields?: TitleFields;
  /** Whether each listed page has a plain-text copy: only once switched on. */
  plainTextCopies?: boolean;
  /** The site's own robots.txt lines, where stored and passing their rule. */
  robotsRules?: StoredRobotsRules;
  /** Why the stored own lines are not served, where they fail their rule. */
  robotsRulesRefused?: string;
  /** Whether listed pages ask for large image previews: on unless `false`. */
  largeImagePreviews?: boolean;
}

/** No rules set: every value comes from the page, its route or its content. */
export const NO_RULES: SiteRules = { patterns: {} };

/**
 * The fields a page's content offers a value from, in the order they are
 * looked at, until the SEO settings map a type's fields. Its title is read
 * from the fields its type names its pages by (`titleSourcesOf`).
 */
const CONTENT_FIELDS = {
  description: ["excerpt", "summary", "description", "subtitle"],
  image: ["coverImage", "cover", "featuredImage", "heroImage", "image"],
} as const;

/** `values` without the keys whose value is undefined. */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/** The type a page belongs to, and its key in the SEO settings. */
export function typeOf(input: PageMetadataInput): {
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

/**
 * A media document as the share card reads it: its id, its stored file and
 * focal point, the inputs to a cut; nothing where it lacks an id or a file.
 */
function cardSourceOf(
  media: unknown,
  image: PageMetadataImage
): CardSource | undefined {
  if (!isRecord(media)) return undefined;
  const id = textOf(media.id);
  const filename = textOf(media.filename);
  if (id === undefined || filename === undefined) return undefined;
  const at = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    ...image,
    id,
    filename,
    ...(typeof media.mimeType === "string" ? { mimeType: media.mimeType } : {}),
    focalX: at(media.focalX),
    focalY: at(media.focalY),
  };
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
  if (page.key === codePagesSlug(ctx)) {
    // A page built in code has no entry and no type declaring its address:
    // its address is the one its route serves it at, in its language.
    return textOf(document.path);
  }
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

/**
 * A document's id as the address record keys its holder: its text, or empty
 * where it has none a record could name.
 */
export function idOf(document: Readonly<Record<string, unknown>>): string {
  const { id } = document;
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
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
  const id = idOf(document);
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
export function laterListPage(
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

/**
 * What the page's own content offers. Its title is its own name, from the
 * fields its type names its pages by; a Single's `title` that is Nextly's,
 * filled from its label, only where none of them holds one.
 */
async function contentLevel(
  ctx: PluginContext,
  document: Readonly<Record<string, unknown>>,
  needImage: boolean,
  { key, titleFields }: { key: string; titleFields?: TitleFields }
): Promise<Levels["content"]> {
  const sources = titleSourcesOf(ctx, key, titleFields);
  return defined({
    title: ownTitleIn(document, [
      ...sources.fields,
      ...(sources.labelTitle ? ["title"] : []),
    ]),
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
): Promise<Levels["content"]["image"]> {
  for (const field of CONTENT_FIELDS.image) {
    const value = document[field];
    if (value === null || value === undefined || value === "") continue;
    const media = await mediaOf(ctx, value);
    const image = asImage(media);
    if (image === undefined) continue;
    // A picture networks would not show in full is served as a card cut
    // from it, named by the picture's version so it follows the picture.
    // Only where the card can be made: with no image library, the picture
    // is served as it is, and the tab says what keeps it from showing.
    const source = cardSourceOf(media, image);
    const card = source === undefined ? undefined : shareCardOf(source);
    if (card !== undefined && (await canMakeShareImages())) {
      return { value: card, field, madeFrom: image };
    }
    return { value: image, field };
  }
  return undefined;
}

/** Whether a level's image has an address to load it from. */
const hasImage = (image: PageMetadataImage | undefined) =>
  textOf(image?.url) !== undefined;

/** Whether an address is a path on the site itself, with no origin. */
const isPath = (address: string) =>
  address.startsWith("/") && !address.startsWith("//");

/**
 * Whether two addresses name the same file: alike in full, or alike in path
 * and query where one is a path on the site and the other a full address on
 * one of the site's own origins, since a route often states its picture at
 * the full address of the path the media library keeps. A full address on
 * any other origin is another site's file, whatever its path.
 */
function sameAddress(
  one: string,
  other: string,
  siteOrigins: readonly string[]
): boolean {
  const base = "https://site.invalid";
  try {
    const a = new URL(one, base);
    const b = new URL(other, base);
    if (isPath(one) === isPath(other)) return a.href === b.href;
    const full = isPath(one) ? b : a;
    return (
      siteOrigins.includes(full.origin) &&
      a.pathname + a.search === b.pathname + b.search
    );
  } catch {
    return false;
  }
}

/**
 * The page's own pictures, each as the media library keeps it, for checking
 * an image a route or a design states. A picture that cannot be looked up is
 * left out here: this check never costs the page an image it has.
 */
async function ownPictures(
  ctx: PluginContext,
  document: Readonly<Record<string, unknown>>
): Promise<PageMetadataImage[]> {
  const pictures: PageMetadataImage[] = [];
  for (const field of CONTENT_FIELDS.image) {
    const value = document[field];
    if (value === null || value === undefined || value === "") continue;
    const picture = await imageOf(ctx, value).catch(() => undefined);
    if (picture !== undefined) pictures.push(picture);
  }
  return pictures;
}

/**
 * An image a route's code or a design states, at the size the media library
 * stores where it is one of the page's own pictures: a route that states its
 * picture as 1200 × 630 when it isn't would have the head claim a share
 * card's size for it, and the crop warning say nothing. The route's own alt
 * text stays; the media item's fills in where it gives none. Any other image
 * is kept as stated.
 */
async function atStoredSize(
  ctx: PluginContext,
  document: Readonly<Record<string, unknown>>,
  image: PageMetadataImage,
  siteOrigins: readonly string[]
): Promise<PageMetadataImage> {
  if (!hasImage(image)) return image;
  const own = (await ownPictures(ctx, document)).find(picture =>
    sameAddress(picture.url, image.url, siteOrigins)
  );
  if (own?.width === undefined || own.height === undefined) return image;
  const alt = image.alt ?? own.alt;
  return {
    ...image,
    width: own.width,
    height: own.height,
    ...(alt === undefined ? {} : { alt }),
  };
}

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

/**
 * A content type's patterns as the order fills them: the type's own, else the
 * site's default, part by part. The one answer to which pattern gives a
 * type's title, for the order and for whatever says which pattern it is.
 */
export function patternsOf(
  rules: SiteRules,
  key: string
): { title?: string; description?: string } {
  return { ...rules.defaultPatterns, ...rules.patterns[key] };
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
  const content = await contentLevel(ctx, document, !higherImage, {
    key,
    ...(rules.titleFields === undefined
      ? {}
      : { titleFields: rules.titleFields }),
  });
  // Only the image that wins is checked against the page's own pictures:
  // the page's own share image is one already, read with its stored size.
  // The site's own origins, which a full address must be on to name one of
  // the page's pictures stored by path.
  const siteOrigins = productionAddressesOf(rules.productionAddresses);
  const codeImage = input.code.image;
  const code =
    hasImage(page.image) || codeImage === undefined
      ? input.code
      : {
          ...input.code,
          image: await atStoredSize(ctx, document, codeImage, siteOrigins),
        };
  const designImage = input.derived.image;
  const template =
    hasImage(page.image) || hasImage(codeImage) || designImage === undefined
      ? input.derived
      : {
          ...input.derived,
          image: await atStoredSize(ctx, document, designImage, siteOrigins),
        };
  const address = await addressOf(
    ctx,
    { type, key },
    document,
    input.locale,
    input.path
  );
  return {
    page,
    code,
    template,
    pattern: patternLevel(
      patternsOf(rules, key),
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
      largeImagePreviews: rules.largeImagePreviews,
    }),
    ...(address === undefined ? {} : { address }),
    ...(rules.hiddenTypes?.includes(key) === true ? { typeHidden: true } : {}),
  };
}
