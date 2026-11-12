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
 * entry: what a person set for the address on the Pages and addresses
 * screen wins, the route's own title, description and social values come
 * next, then the site's title pattern and defaults. Its canonical is its own
 * address, and its visibility is the screen's, never the route's.
 *
 * @module code-pages/metadata
 */
import {
  getCachedNextly,
  NextlyError,
  pluginCacheTag,
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
   * used where nobody set one for the address; its visibility and canonical
   * are never used, so the page and the sitemap agree. Anything else it
   * sets, such as keywords, is kept.
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
  const address = codeAddressOf(path);
  if (address === undefined) {
    throw NextlyError.invalidInput({
      message: `seoMetadata: "${path}" is not an address from the site's root, such as "/pricing".`,
      logContext: { path },
    });
  }
  const own = options.metadata ?? {};
  const runtime = await import("nextly/runtime");
  // A worker whose cache already holds the row reads nothing that would
  // start Nextly, and the page's head is asked of the SEO plugin only once
  // it has started: so a start not made yet is awaited here.
  if (keptSeoContext() === undefined) {
    try {
      await getCachedNextly();
    } catch {
      return own;
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
    return own;
  }
  // Nextly or the SEO plugin is not running here.
  if (found === null) return own;
  const row = found.row ?? undefined;
  const pageMetadata = runtime.contentPageMetadata;
  return pageMetadata(
    {
      ...(options.metadata === undefined ? {} : { buildMetadata: () => own }),
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
    address
  );
}
