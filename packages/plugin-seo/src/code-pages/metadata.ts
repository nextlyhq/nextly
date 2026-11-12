/**
 * The one line a page built in code adds so the SEO set for its address
 * reaches it:
 *
 * ```ts
 * import { seoMetadata } from "@nextlyhq/plugin-seo";
 *
 * export const generateMetadata = () =>
 *   seoMetadata("/pricing", { metadata: { title: "Pricing" } });
 * ```
 *
 * The page is answered by the same order of who wins as every page with an
 * entry: what a person set for the address on Pages wins, the route's own
 * title, description and social values come
 * next, then the site's title pattern and defaults. Its canonical is its own
 * address. It is hidden where the screen hides it or its route's own
 * metadata does; the route can hide it, never list one the screen hides.
 *
 * `seoStructuredData` reads the page's structured data from the same answer,
 * for the page to place in its body.
 *
 * @module code-pages/metadata
 */
import {
  getCachedNextly,
  NextlyError,
  pluginCacheTag,
  type PageStructuredDataHints,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import type { contentPageMetadata } from "nextly/runtime";

import { keptSeoContext } from "../not-found/report";
import { textOf } from "../plain-values";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { CODE_PAGES_CACHE_PART, codePagesSlug } from "./collection";
import {
  codeAddressOf,
  codePageDocument,
  nameOfAddress,
  readCodePage,
  type CodePageRow,
} from "./store";

/** A route's metadata, as Next.js reads it from `generateMetadata`. */
export type RouteMetadata = Awaited<ReturnType<typeof contentPageMetadata>>;

/** What a page built in code tells {@link seoMetadata} besides its address. */
export interface SeoMetadataOptions {
  /**
   * The route's own metadata. Its title, description and social values are
   * used where nobody set one for the address. Its `noindex` hides the page,
   * and leaves it out of the sitemap; its canonical is never used, since the
   * page's own address is. Anything else it sets, such as keywords or
   * Google's preview limits, is kept.
   */
  metadata?: RouteMetadata;
  /**
   * What the page is called, which `{Title}` stands for in the site's title
   * pattern. Taken from the address where not given: `/thank-you` is
   * "Thank you".
   */
  name?: string;
  /** The language the route serves the page in, where it serves several. */
  locale?: string;
  /**
   * What the page shows that structured data cannot read elsewhere: what
   * kind of page it is (such as `"aboutPage"`), its own name, the entries it
   * lists and the questions it answers. Read by `seoStructuredData` only;
   * the head is the same with or without it.
   */
  structuredDataHints?: PageStructuredDataHints;
}

/** The started plugin's context, starting Nextly first where nothing has. */
async function seoContext(): Promise<PluginContext | undefined> {
  const kept = keptSeoContext();
  if (kept !== undefined) return kept;
  // A start that fails throws, so the read is not kept as "no plugin": the
  // route serves its own metadata this once and the next request starts
  // Nextly again.
  await getCachedNextly();
  return keptSeoContext();
}

/** The row of an address, and the collection it is read from. */
interface CodePageRead {
  collection: string;
  row: CodePageRow | null;
}

/**
 * The row holding `address`'s SEO, and the collection it is read from; null
 * where the SEO plugin is not running. Plain data, so the site's cache can
 * keep it.
 */
async function readRow(address: string): Promise<CodePageRead | null> {
  const ctx = await seoContext();
  if (ctx === undefined) return null;
  const row = await readCodePage(ctx, address);
  return { collection: codePagesSlug(ctx), row: row ?? null };
}

/** The arguments `contentPageMetadata` and `contentPageStructuredData` take. */
type CodePageAsk = Parameters<typeof contentPageMetadata>;

/**
 * What the site's page-metadata provider is asked about the page built in
 * code at `path`, so the head and the structured data are asked alike and
 * read one answer. Null where Nextly or the SEO plugin is not running, or the
 * address's SEO cannot be read.
 */
async function codePageAsk(
  path: string,
  options: SeoMetadataOptions,
  caller: string
): Promise<CodePageAsk | null> {
  const address = codeAddressOf(path);
  if (address === undefined) {
    throw NextlyError.invalidInput({
      message: `${caller}: "${path}" is not an address from the site's root, such as "/pricing".`,
      logContext: { path },
    });
  }
  const runtime = await import("nextly/runtime");
  // A worker whose cache already holds the row reads nothing that would
  // start Nextly, and the page's head is asked of the SEO plugin only once
  // it has started: so a start not made yet is awaited here.
  if (keptSeoContext() === undefined) {
    try {
      await getCachedNextly();
    } catch {
      return null;
    }
  }
  // The plugin's own tag, which a save on the screen expires.
  const tags = [pluginCacheTag(SEO_PLUGIN_NAME, CODE_PAGES_CACHE_PART)];
  let found: CodePageRead | null;
  try {
    // Read through the site's cache, as a content route reads its entry, so
    // a page built ahead of time reads it while it is built, Nextly started
    // inside the read where nothing has started it, and is expired by a
    // save. Whether the route is connected is recorded as its head is
    // answered (`code-pages/connections`).
    found = await runtime.cachedFind(() => readRow(address), {
      keyParts: ["nextly-seo-code-page", address],
      tags,
    });
  } catch (error) {
    keptSeoContext()?.logger.error(
      "The SEO of a page built in code could not be read",
      { path: address, error }
    );
    return null;
  }
  // Nextly or the SEO plugin is not running here.
  if (found === null) return null;
  const row = found.row ?? undefined;
  const own = options.metadata;
  return [
    {
      ...(own === undefined ? {} : { buildMetadata: () => own }),
      ...(options.structuredDataHints === undefined
        ? {}
        : { structuredDataHints: () => options.structuredDataHints }),
      // A save on the screen expires these, so the page serves it from its
      // next visit, a page built ahead of time included.
      tags,
    },
    // Named as the route names it now, never as a call once recorded it.
    codePageDocument(
      address,
      row,
      textOf(options.name) ?? nameOfAddress(address)
    ),
    {
      collection: found.collection,
      slug: address.slice(1),
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    },
    address,
  ];
}

/**
 * The head of the page built in code at `path`, from the SEO set for its
 * address and the route's own metadata.
 *
 * Where Nextly or the SEO plugin is not running, or the address's SEO cannot
 * be read, it is the route's own metadata unchanged, so the page is served
 * whatever happens to its SEO.
 *
 * @throws NextlyError when `path` is not an address from the site's root.
 */
export async function seoMetadata(
  path: string,
  options: SeoMetadataOptions = {}
): Promise<RouteMetadata> {
  const ask = await codePageAsk(path, options, "seoMetadata");
  if (ask === null) return options.metadata ?? {};
  const { contentPageMetadata } = await import("nextly/runtime");
  return contentPageMetadata(...ask);
}

/**
 * The structured data of the page built in code at `path`, as JSON-LD text
 * written so that no value can end its script element: read from the same
 * answer as {@link seoMetadata} when given the same options, so the page's
 * body describes the page its head does. Place it with `jsonLdScriptProps`
 * from `nextly/runtime`:
 *
 * ```tsx
 * import { jsonLdScriptProps } from "nextly/runtime";
 * import { seoStructuredData } from "@nextlyhq/plugin-seo";
 *
 * const own = { title: "Pricing" };
 * export const generateMetadata = () => seoMetadata("/pricing", { metadata: own });
 *
 * export default async function PricingPage() {
 *   const structuredData = await seoStructuredData("/pricing", { metadata: own });
 *   return (
 *     <>
 *       {structuredData && <script {...jsonLdScriptProps(structuredData)} />}
 *       <h1>Pricing</h1>
 *     </>
 *   );
 * }
 * ```
 *
 * Nothing where Nextly or the SEO plugin is not running, or the answer has
 * no structured data.
 *
 * @throws NextlyError when `path` is not an address from the site's root.
 */
export async function seoStructuredData(
  path: string,
  options: SeoMetadataOptions = {}
): Promise<string | undefined> {
  const ask = await codePageAsk(path, options, "seoStructuredData");
  if (ask === null) return undefined;
  const { contentPageStructuredData } = await import("nextly/runtime");
  return contentPageStructuredData(...ask);
}
