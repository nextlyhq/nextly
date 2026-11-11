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
import { isRecord, textOf } from "../plain-values";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { CODE_PAGES_CACHE_PART, codePagesSlug } from "./collection";
import type { CodeRoute } from "./routes";
import {
  codeAddressOf,
  codePageDocument,
  readCodePage,
  recordConnection,
  recorded,
  type CodePageRow,
  type Connection,
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

/**
 * The code routes the running site has, as the plugin was configured to
 * read them, on `globalThis` so a route's module reaches the reader whatever
 * module the plugin started in.
 */
const shared = globalThis as unknown as {
  __nextly_seoCodeRoutes?: () => CodeRoute[];
};

/** Keep the started plugin's reader of the site's code routes. */
export function keepCodeRoutes(read: () => CodeRoute[]): void {
  shared.__nextly_seoCodeRoutes = read;
}

/** The started plugin's context, starting Nextly first where nothing has. */
async function seoContext(): Promise<PluginContext | undefined> {
  const kept = keptSeoContext();
  if (kept !== undefined) return kept;
  try {
    await getCachedNextly();
  } catch {
    // Nothing the app registered to start: the page keeps its own metadata.
    return undefined;
  }
  return keptSeoContext();
}

/** Whether this is `next build` rendering the site's own pages. */
const building = () => process.env.NEXT_PHASE === "phase-production-build";

/**
 * Whether a call for `path` may record that its route is connected: during
 * the build, which renders only the site's own addresses, or for an address
 * the site already knows of. A request for any other address must not make
 * a row, or each made-up address a visitor asks for would add one.
 */
function mayRecord(path: string, row: CodePageRow | undefined): boolean {
  if (building() || row !== undefined) return true;
  const read = shared.__nextly_seoCodeRoutes;
  return read !== undefined && read().some(route => route.path === path);
}

/** What the route's call says about the page it serves. */
function connectionOf(options: SeoMetadataOptions): Connection {
  const code = options.metadata;
  // A title as text: a plain one, or the page's own of a template.
  const title: unknown = code?.title;
  const text = isRecord(title)
    ? (textOf(title.absolute) ?? textOf(title.default))
    : textOf(title);
  const name = textOf(options.name);
  const codeTitle = textOf(text);
  const codeDescription = textOf(code?.description ?? undefined);
  return {
    ...(name === undefined ? {} : { name }),
    ...(codeTitle === undefined ? {} : { codeTitle }),
    ...(codeDescription === undefined ? {} : { codeDescription }),
  };
}

/** The row of an address, and the collection it is read from. */
interface CodePageRead {
  collection: string;
  row: CodePageRow | null;
}

/**
 * The row holding `address`'s SEO, the route's call recorded first where it
 * says something the row does not and may be recorded; null where the SEO
 * plugin is not running. Plain data, so the site's cache can keep it.
 */
async function readAndRecord(
  address: string,
  connection: Connection
): Promise<CodePageRead | null> {
  const ctx = await seoContext();
  if (ctx === undefined) return null;
  let row = await readCodePage(ctx, address);
  if (!recorded(row, connection) && mayRecord(address, row)) {
    await recordConnection(ctx, address, row, connection);
    row = await readCodePage(ctx, address);
  }
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
  const connection = connectionOf(options);
  // The plugin's own tag, which a save on the screen expires.
  const tags = [pluginCacheTag(SEO_PLUGIN_NAME, CODE_PAGES_CACHE_PART)];
  let found: CodePageRead | null;
  try {
    // Read through the site's cache, as a content route reads its entry, so
    // a page built ahead of time reads it while it is built, Nextly started
    // inside the read where nothing has started it, and is expired by a
    // save. The route's call is recorded on a miss: with what it says in
    // the key, a call saying something new is a miss, and one saying the
    // same again writes nothing.
    found = await runtime.cachedFind(() => readAndRecord(address, connection), {
      keyParts: ["nextly-seo-code-page", address, JSON.stringify(connection)],
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
    codePageDocument(address, row, textOf(options.name)),
    {
      collection: found.collection,
      slug: address.slice(1),
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    },
    address
  );
}
