/**
 * Which instance a route reads through, and the readers built over it: the
 * public reader a page's lists read with (each read cached and tagged like
 * the page), where the site settings are read, and the data provider one
 * render uses.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-readers
 */
import {
  cachedFind,
  createPublicReader,
  requireNextly,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
  readPublicSiteSettings,
} from "nextly/runtime";
import type {
  NextlyContentReader,
  NextlySingleReader,
  PublicSiteSettings,
  PublicSiteSettingsSource,
} from "nextly/runtime";

import { readWasRefused } from "./blocks/list-read-refusal";
import { createDefaultDataProvider } from "./context";
import type {
  BlocksDataProvider,
  BlocksDataProviderFactory,
  BlocksPublicReader,
} from "./context";
import type { BlocksPageConfig } from "./next-page-config";
import {
  offeredSiteBlocks,
  SITE_BLOCKS_SERVICE,
  type BlockResolver,
} from "./resolver";

/**
 * The instance this route reads through.
 *
 * Resolved the same way `createContentRoute` resolves its own — the caller's
 * `nextly` when given, the process instance otherwise — so the page and the
 * records it embeds come from ONE place. On a per-tenant setup a second
 * instance is a second database, and the mismatch surfaces as missing relations
 * rather than as an error.
 *
 * Read here rather than taken off the render context. Carrying it there meant
 * publishing a trusted reader to every third-party callback, and every attribute
 * that makes it trusted — access, both identity channels, lifecycle, locale —
 * had to be re-bound, each failing independently. These resolvers pass all of
 * them explicitly on every call, so they never depended on those defaults.
 */
export function readerFor(config: BlocksPageConfig): NextlyContentReader {
  return config.nextly ?? requireNextly();
}

/**
 * The blocks of the site this process serves, for a route given no `blocks`:
 * the page builder's registry, read from the process's instance on each
 * lookup. The route reads its entry first, which starts the site and fills
 * its registry, so a page draws its registered blocks before any admin has
 * opened.
 *
 * Read per lookup rather than captured, because a dev-server hot reload
 * starts the site again with a new registry. Refused, never answered empty,
 * when the instance has no page builder: every block would otherwise draw as
 * an unknown one, on a page that looks served correctly.
 *
 * The process's instance, because the services an instance offers are kept
 * once per process. A host serving two sites from one process binds each
 * route to its site's page builder with `blocks: blocksOf(builder)`.
 */
export function siteBlocks(): BlockResolver {
  return { get: type => siteRegistry().get(type) };
}

function siteRegistry(): BlockResolver {
  const offered = offeredSiteBlocks(requireNextly().plugins);
  if (offered !== undefined) return offered;
  throw new Error(
    "[blocks-react] This route has no `blocks`, and the Nextly instance has no " +
      `page builder to read them from. Install "${SITE_BLOCKS_SERVICE.plugin}", ` +
      "or pass `blocks` to the route."
  );
}

/**
 * The public reader a page's lists read through, for one render.
 *
 * Each read is cached like the page around it, keyed by the route's cache
 * scope, the page's language and the whole read, and tagged with its
 * collection or Single so a write there refreshes the page. The read is the
 * same for every visitor (anonymous, published), so one entry serves them all.
 * A change to what a role grants expires every content tag, so taking a read
 * away from the public refreshes the entry too, and a read the public is
 * refused is kept as the refusal (`cachedFind`), so once refused it stays
 * refused until the entry is read again. A change to a rule in code ships with
 * a deploy.
 *
 * The cache holds the public reader's whole answer, not the instance's row:
 * the reader then judges which fields the public may see inside the cached
 * read. Under Cache Components a page is prerendered, and a prerender refuses
 * a read outside the cache that takes the current time, as that judgement
 * does when it checks the access rules are current.
 */
export function publicReaderFor(
  config: BlocksPageConfig,
  locale: string | undefined,
  window: number | false | undefined
): BlocksPublicReader {
  const nextly = readerFor(config);
  const singles = singleReaderOf(nextly);
  const reader = createPublicReader(
    {
      find: async args => await nextly.find(args),
      ...(singles === undefined
        ? {}
        : { findSingle: singles.findSingle.bind(singles) }),
    },
    locale === undefined ? {} : { locale }
  );
  const cached = async <T>(
    kind: string,
    tags: string[],
    query: object,
    read: () => Promise<T>
  ): Promise<T> =>
    await cachedFind(read, {
      tags,
      keyParts: [
        kind,
        config.cacheScope ?? "",
        locale ?? "",
        JSON.stringify(query),
      ],
      // The route's own window bounds it too, so a read never outlives the
      // page around it.
      revalidate: await releaseBoundedRevalidate(window),
    });
  const findSingle = reader.findSingle.bind(reader);
  return {
    find: async query =>
      answerOrRefusal(
        await cached(
          "nextly-public-list",
          nextlyTags(query.collection),
          query,
          async () => await keepingListRefusal(() => reader.find(query))
        )
      ),
    count: async query =>
      await cached(
        "nextly-public-count",
        nextlyTags(query.collection),
        query,
        async () => await reader.count(query)
      ),
    ...(singles === undefined
      ? {}
      : {
          findSingle: async query =>
            await cached(
              "nextly-public-single",
              nextlySingleTags(query.slug),
              query,
              async () => await findSingle(query)
            ),
        }),
  };
}

/**
 * A list's read as the cache keeps it: its answer, or the reader's refusal of
 * it (a sort on a field the collection no longer has or visitors can't see).
 *
 * A refusal is kept by value because a `"use cache"` function hands back what
 * it can serialize: a thrown error arrives without its code and public data,
 * and a list could then no longer tell a refused sort from a failed read, so
 * it would draw nothing instead of its entries in id order. Every other error
 * still throws, so a fault is never kept as an answer.
 */
interface RefusedListRead {
  readonly refusedRead: {
    readonly message: string;
    readonly code: unknown;
    readonly publicData: unknown;
  };
}

/** `read`, answering the reader's refusal with the refusal as a value. */
async function keepingListRefusal<T>(
  read: () => Promise<T>
): Promise<T | RefusedListRead> {
  try {
    return await read();
  } catch (error) {
    if (!readWasRefused(error)) throw error;
    const { message, code, publicData } = error as {
      message?: unknown;
      code?: unknown;
      publicData?: unknown;
    };
    return {
      refusedRead: {
        message: typeof message === "string" ? message : "Refused.",
        code,
        publicData,
      },
    };
  }
}

/** A list's kept answer, throwing a kept refusal in the shape a list reads. */
function answerOrRefusal<T>(kept: T | RefusedListRead): T {
  if (typeof kept !== "object" || kept === null || !("refusedRead" in kept)) {
    return kept;
  }
  const { message, ...parts } = kept.refusedRead;
  throw Object.assign(new Error(message), parts);
}

/** The instance's Single read, when the reader the route holds has one. */
function singleReaderOf(reader: object): NextlySingleReader | undefined {
  return "findSingle" in reader && typeof reader.findSingle === "function"
    ? (reader as NextlySingleReader)
    : undefined;
}

/**
 * The process's registered instance, standing in for the site settings of a
 * reader of the app's own that offers no site-settings read.
 *
 * It reads what such a route read before an instance could be asked, so a
 * single-site app whose reader predates `publicSiteSettings` keeps its site
 * name and time zone. It is a stand-in rather than a quiet fallback because on
 * a process serving several sites it is another site's settings: the read
 * that uses one says so, naming the reader's missing line.
 *
 * Whether a process serves several sites cannot be asked of Nextly. Every
 * handle `getNextly`, `getCachedNextly` and `requireNextly` give out is one
 * process-wide instance over one service container, both kept on
 * `globalThis`, so a process never holds two instances to count; its other
 * sites are readers of the app's own, which nothing here can see.
 */
export class ProcessSiteSettings implements PublicSiteSettingsSource {
  constructor(readonly reader: object) {}

  async publicSiteSettings(): Promise<PublicSiteSettings> {
    return await readPublicSiteSettings();
  }
}

/** The readers already warned about, so each is named once per process. */
const warnedReaders = new WeakSet<object>();

/**
 * Said once per reader, in every environment, when a page reads the site
 * settings through a stand-in: a production log is where a site showing
 * another site's name would otherwise go unexplained.
 */
export function warnOfStandIn(standIn: ProcessSiteSettings): void {
  if (warnedReaders.has(standIn.reader)) return;
  warnedReaders.add(standIn.reader);
  console.warn(
    "[blocks] This route's `nextly` reader has no `publicSiteSettings`, so its pages show the site settings of the process's registered Nextly instance. On a process serving several sites those are another site's name and time zone. Add one line to the reader: `publicSiteSettings: async () => (await instance()).publicSiteSettings()`."
  );
}

/**
 * Where a route's pages read the site settings: the instance the route reads
 * its records through, chosen by {@link readerFor} and nowhere else, so a
 * page's site name and time zone come from the same instance as its content.
 * A route given no instance reads the process's, as its records do. A reader
 * of the app's own without a site-settings read gets the process's registered
 * instance as a {@link ProcessSiteSettings} stand-in.
 */
export function siteSettingsSourceFor(
  config: BlocksPageConfig
): PublicSiteSettingsSource {
  const reader: object = readerFor(config);
  return "publicSiteSettings" in reader &&
    typeof reader.publicSiteSettings === "function"
    ? (reader as PublicSiteSettingsSource)
    : new ProcessSiteSettings(reader);
}

/** The route's data provider for one render: the caller's, or the default. */
export function dataFor(
  factory: BlocksDataProviderFactory | undefined,
  config: BlocksPageConfig,
  locale: string | undefined,
  window: number | false | undefined
): BlocksDataProvider {
  return (factory ?? createDefaultDataProvider)(
    publicReaderFor(config, locale, window)
  );
}
