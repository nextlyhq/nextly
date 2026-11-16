/**
 * How a published page runs its lists' named queries: over the route's
 * public reader, inside nextly's named-query frame, each run cached and tagged
 * by what the query declares, plus how many pages such a list has.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-named-queries
 */
import {
  calendarDayIn,
  type PaginatedList,
  safeTimeZone,
} from "@nextlyhq/blocks-engine";
import {
  cachedFind,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
  nextlySiteSettingsTags,
  readPublicSiteSettings,
  openNamedQueryFrame,
} from "nextly/runtime";
import type { RenderContext } from "nextly/runtime";

import { listPagesOf, namedListBase } from "./blocks/list-read";
import { namedQueryFailureLine, readNamedList } from "./blocks/named-read";
import { createStandaloneContext } from "./context";
import type { NamedQueryHost, QueryBudget } from "./context";
import type { BlocksPageConfig } from "./next-page-config";
import { readSite, cachedFieldShapes } from "./next-read-sources";
import {
  publicReaderFor,
  ProcessSiteSettings,
  warnOfStandIn,
  siteSettingsSourceFor,
} from "./next-readers";

/**
 * The most tags a named query's cached result carries: Next keeps 128 per
 * cache entry, and nextly's reads keep to it (`readTags`).
 */
const NAMED_QUERY_CACHE_TAGS = 128;

/** This process's own identity, for a deployment that names none. */
const PROCESS_IDENTITY = `process:${globalThis.crypto.randomUUID()}`;

/**
 * Which deployment this code is: the one the platform names
 * (`NEXT_DEPLOYMENT_ID`, which Next sets from its `deploymentId`, or
 * Vercel's), else this process's own identity. A named query's cached
 * result is kept under it, because a deployment can change what `run`
 * computes (an imported helper, a constant) without changing a character of
 * its source: a result is never served across deployments. With no
 * deployment named, it is never served across processes either, which
 * costs a fresh run after a restart and never serves stale rows.
 */
function deploymentIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const named = [
    env.NEXT_DEPLOYMENT_ID,
    env.VERCEL_DEPLOYMENT_ID,
    env.VERCEL_GIT_COMMIT_SHA,
  ].find(value => value !== undefined && value.trim() !== "");
  return named === undefined ? PROCESS_IDENTITY : `deployment:${named}`;
}

/**
 * The site's time zone, for a named query's day: the route's, else the one
 * the site settings name, UTC only when they name none. Settings that could
 * not be read (the page's reads spent, or the read failing) are not settings
 * that name no zone: that refuses, and the list draws its empty state rather
 * than run a query on another zone's day.
 */
async function siteZone(
  config: BlocksPageConfig,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<string | undefined> {
  if (config.timeZone !== undefined) return config.timeZone;
  const site = await readSite(
    siteSettingsSourceFor(config),
    config.cacheScope,
    budget,
    window
  );
  if (site === undefined) {
    throw new Error(
      "The site settings could not be read, so the site's time zone, and today in it, is not known."
    );
  }
  return site.timezone ?? undefined;
}

/** How long a cached "today" may live before it is asked again, in seconds. */
const TODAY_LIFETIME = 60;

/**
 * Today in the site's time zone, for a named query: cached, because a
 * prerender under Cache Components refuses the current time outside the
 * cache, and tagged with the site settings, whose time zone it is read in.
 */
async function todayFor(zone: string | undefined): Promise<string> {
  const safe = safeTimeZone(zone).zone;
  return await cachedFind(
    () => Promise.resolve(calendarDayIn(safe, new Date())),
    {
      tags: nextlySiteSettingsTags(),
      keyParts: ["nextly-named-query-today", safe],
      revalidate: TODAY_LIFETIME,
    }
  );
}

/**
 * How a published page runs its lists' named queries: over the route's
 * public reader, as an anonymous visitor reads, each run inside nextly's
 * named-query frame, which refuses a trusted Direct API call from developer
 * code. A run's result is cached like the page around it, keyed by its
 * query, inputs and window, and tagged by everything the query DECLARES, so
 * a write to any collection, Single or setting it may read refreshes the
 * page, whether or not this run happened to read it.
 */
export function namedQueryHostFor(args: {
  readonly config: BlocksPageConfig;
  readonly locale: string | undefined;
  readonly window: number | false | undefined;
  readonly budget: QueryBudget;
  readonly context: RenderContext;
}): NamedQueryHost {
  const { config, locale, window, budget, context } = args;
  const reader = publicReaderFor(config, locale, window);
  let today: Promise<string> | undefined;
  return {
    // The site's own queries, as the route was handed them: none when it
    // was handed none, so a list naming one shows its empty state.
    definitionOf: name => config.namedQueries?.definitionOf(name),
    reader: {
      ...reader,
      // The route's own instance's settings, as the page's own read takes
      // them, so a process serving several sites never hands a query
      // another site's name or zone. The reader already counted this read.
      siteSettings: async () => {
        const from = siteSettingsSourceFor(config);
        if (from instanceof ProcessSiteSettings) warnOfStandIn(from);
        const settings = await cachedFind(
          async () => await readPublicSiteSettings(from),
          {
            tags: nextlySiteSettingsTags(),
            keyParts: ["nextly-public-site-settings", config.cacheScope ?? ""],
            revalidate: await releaseBoundedRevalidate(window),
          }
        );
        return { ...settings };
      },
    },
    today: () => {
      today ??= (async () =>
        await todayFor(await siteZone(config, budget, window)))();
      return today;
    },
    fieldsOf: async collection =>
      await cachedFieldShapes(
        { collection },
        { scope: config.cacheScope ?? "", locale, window }
      ),
    // nextly's frame: inside it the Direct API refuses every call, and the
    // query's reader reads through the frame's own door.
    frame: name => openNamedQueryFrame(name),
    cache: async ({ declaration, key, read }) => {
      const tags = [
        ...(declaration.reads.collections ?? []).flatMap(slug =>
          nextlyTags(slug)
        ),
        ...(declaration.reads.singles ?? []).flatMap(slug =>
          nextlySingleTags(slug)
        ),
        ...(declaration.reads.site === true ? nextlySiteSettingsTags() : []),
      ];
      // A result is kept only when every source it declares can expire it.
      // The cache keeps a bounded number of tags per entry, and a read past
      // the bound would stay cached after a write to a source left off. The
      // registry bounds a query's reads below this; this holds it whatever
      // a tag costs.
      if (new Set(tags).size > NAMED_QUERY_CACHE_TAGS) return await read();
      const route = await releaseBoundedRevalidate(window);
      const own = declaration.revalidate;
      return await cachedFind(read, {
        tags,
        keyParts: [
          "nextly-named-query",
          config.cacheScope ?? "",
          deploymentIdentity(),
          ...key,
        ],
        revalidate:
          own === undefined
            ? route
            : route === false
              ? own
              : Math.min(route, own),
      });
    },
    // The log names the page, the list and the query, under the reference
    // an author is shown in place of the error, and the error by its code or
    // class only: its message may hold whatever the query's code put in it.
    report: failure => {
      console.warn(
        namedQueryFailureLine(
          failure,
          `"${context.collection}" page "${context.slug}"`
        )
      );
    },
  };
}

/**
 * How many pages a paginated list whose source is a named query has, from
 * its run's total by the list's own window (`listPagesOf`, the collection
 * list's count), or `undefined` for a list with another source.
 *
 * The run is the one the list's first page makes: the same host (frame,
 * reader and cache), window, inputs and language, so a result the host
 * kept serves both, and its reads are claimed from `budget` as the render
 * claims them, as they are made or replayed. A run that fails, or returns
 * no total, gives one page: the list draws its empty state, so no later
 * page exists, and no count is guessed. The failure is logged here, through
 * the host's own report: the later page asked for is then not found, so no
 * render follows that would log it.
 */
export async function namedListPages(
  list: PaginatedList,
  host: NamedQueryHost,
  budget: QueryBudget,
  locale: string | undefined
): Promise<number | undefined> {
  const base = namedListBase(list.props);
  if (base === undefined) return undefined;
  if ("blocking" in base) return 1;
  const outcome = await readNamedList(
    base.named,
    { limit: base.limit, offset: base.offset },
    {
      ...createStandaloneContext({ locale, queries: budget }),
      namedQueries: host,
    },
    list.id,
    { counted: true }
  );
  return outcome.failed || outcome.total === undefined
    ? 1
    : listPagesOf(list.props, outcome.total);
}
