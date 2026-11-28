/**
 * The routes that serve the site's `/sitemap.xml`, `/robots.txt` and, once
 * switched on, `/llms.txt` at its root. `withNextly` rewrites each to the API
 * handler, and a site that ships its own file keeps serving it.
 *
 * @module outputs/root-routes
 */
import type { PluginRoute, PluginRouteContext } from "@nextlyhq/plugin-sdk";

import {
  RECORD_WAIT_MS,
  addressRecordReadyWithin,
} from "../address-record/catch-up";
import type { ReadCodeRoutes } from "../code-pages/routes";
import { feedXmlOf } from "../feeds/feed";
import type { CheckedFeed } from "../feeds/options";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { servesFolderFiles } from "../settings/ai-files";
import { ROBOTS_SERVED_BY_HEADER } from "../settings/robots-rules";
import type { ReadStructuredDataRules } from "../structured-data/rules";

import { llmsFullTxtOf, llmsTxtOf, type AiOutputsConfig } from "./ai-outputs";
import { keepCopy, keptCopy, keptCopyResponse } from "./last-good";
import { listPages } from "./listing";
import { robotsTxt, type AiCrawlerChoice } from "./robots";
import { siteOriginFor } from "./site-origin";
import { sitemapAnswer, type SitemapLimits } from "./sitemap-files";

/** What the root files are served with. */
export interface RootFilesConfig {
  /**
   * The site's origin, where configured. Without one, each request's own
   * origin is used, and the answer is not cached, since a request's host can
   * be anything its sender says.
   */
  origin?: string;
  readRules: ReadRules;
  /** Structured data's rules, for the images a content type maps. */
  readStructuredDataRules?: ReadStructuredDataRules;
  /** Whether the sitemap is served, and what it lists and splits by. */
  sitemap?: { collections?: readonly string[]; limits: SitemapLimits };
  /** Whether robots.txt is served, and what it asks AI crawlers. */
  robots?: { aiCrawlers: AiCrawlerChoice };
  /** The pages the site's routes render from their own code. */
  codeRoutes?: ReadCodeRoutes;
  /** The Markdown the options give for a page built in code, which its copy is made of. */
  codeMarkdown?: AiOutputsConfig["codeMarkdown"];
  /** The site's RSS feeds, as its options name them. */
  feeds?: readonly CheckedFeed[];
  /**
   * The configured origin the feeds name the site by, where a baseUrl is
   * set, whether or not the sitemap is served.
   */
  feedOrigin?: string;
}

/**
 * The site's origin for one request, and the headers that follow from it:
 * {@link siteOriginFor}, else the request's own, which nothing may cache,
 * since a request's host can be anything its sender says. `own` says it is
 * the site's own.
 */
async function originOf(
  req: Request,
  ctx: PluginRouteContext,
  config: RootFilesConfig,
  contentType: string
): Promise<{ origin: string; headers: Record<string, string>; own: boolean }> {
  const headers: Record<string, string> = { "content-type": contentType };
  const asked = new URL(req.url).origin;
  const site = await siteOriginFor(asked, ctx, config);
  if (site !== undefined) return { origin: site, headers, own: true };
  headers["cache-control"] = "no-store";
  return { origin: asked, headers, own: false };
}

const notFound = () => new Response("Not found", { status: 404 });

/**
 * The warnings already given, so one about stored rules that are not served
 * is logged once per process, not on every robots.txt request. Bounded, so a
 * value edited again and again cannot grow it without end.
 */
const warned = new Set<string>();

/** Logs `message` the first time it is seen. */
function warnOnce(message: string, warn: (message: string) => void): void {
  if (warned.has(message) || warned.size >= 20) return;
  warned.add(message);
  warn(message);
}

/**
 * Whether a file listing pages can be answered from the record, and if not,
 * the answer: a page may not hold its address yet, and a listing read now
 * would leave it out. The request waits for the record, up to
 * {@link RECORD_WAIT_MS}, bringing it up to date itself where it is behind
 * (`addressRecordReadyWithin`), so a catch-up goes on on a host that runs
 * nothing between requests. Past that, the copy of `file` kept from the last
 * good answer is served where there is one, for the site's own origin; else
 * readers are asked to come back, and nothing in between keeps the answer.
 * Null once the record is ready.
 */
async function catchingUp(
  ctx: PluginRouteContext,
  what: string,
  file: string | undefined
): Promise<Response | null> {
  if (await addressRecordReadyWithin(RECORD_WAIT_MS)) return null;
  const kept = file === undefined ? undefined : await keptCopy(ctx, file);
  if (kept !== undefined) return keptCopyResponse(kept);
  return new Response(`The ${what} is being brought up to date.`, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "120" },
  });
}

/**
 * The answer with `body`, kept as the last good copy of `file` where `file`
 * is named (the site's own origin), so it can be served while the record
 * catches up; not found where there is no body.
 */
async function answered(
  ctx: PluginRouteContext,
  file: string | undefined,
  body: string | null,
  headers: Record<string, string>
): Promise<Response> {
  if (body === null) return notFound();
  const contentType = headers["content-type"];
  if (file !== undefined && contentType !== undefined) {
    await keepCopy(ctx, file, { body, contentType });
  }
  return new Response(body, { headers });
}

/**
 * The name a kept copy is filed under: the file, the origin it names, the
 * path it is served at and what of the request changes it. None where the
 * origin is the request's own, which is never kept.
 */
function fileName(
  file: string,
  origin: { origin: string; own: boolean },
  parts: readonly string[] = []
): string | undefined {
  return origin.own
    ? JSON.stringify([file, origin.origin, ...parts])
    : undefined;
}

/**
 * The sitemap's answer: one file, or the index of several, and the file a
 * `?page=` names. A page number that names no file is not found. The index
 * names each file at `at`, the path this answer is served at; absent, the
 * path the request reached, so an address other than the root names files
 * that reach this same route.
 */
export async function sitemapResponse(
  req: Request,
  ctx: PluginRouteContext,
  config: RootFilesConfig & {
    sitemap: NonNullable<RootFilesConfig["sitemap"]>;
  },
  at?: string
): Promise<Response> {
  const url = new URL(req.url);
  const asked = url.searchParams.get("page");
  if (asked !== null && !/^[1-9][0-9]{0,8}$/.test(asked)) return notFound();
  const site = await originOf(
    req,
    ctx,
    config,
    "application/xml; charset=utf-8"
  );
  const { origin, headers } = site;
  const sitemap = `${origin}${at ?? url.pathname}`;
  const file = fileName("sitemap", site, [sitemap, asked ?? ""]);
  const waiting = await catchingUp(ctx, "sitemap", file);
  if (waiting !== null) return waiting;
  const { pages } = await listPages(ctx, {
    origin,
    readRules: config.readRules,
    ...(config.readStructuredDataRules === undefined
      ? {}
      : { readStructuredDataRules: config.readStructuredDataRules }),
    ...(config.codeRoutes === undefined
      ? {}
      : { codeRoutes: config.codeRoutes }),
    ...(config.sitemap.collections === undefined
      ? {}
      : { collections: config.sitemap.collections }),
  });
  const body = sitemapAnswer(pages, {
    sitemap,
    limits: config.sitemap.limits,
    ...(asked === null ? {} : { page: Number(asked) }),
  });
  return answered(ctx, file, body, headers);
}

/** The routes serving the root files `config` turns on. */
export function rootFileRoutes(config: RootFilesConfig): PluginRoute[] {
  const routes: PluginRoute[] = [];
  const { sitemap, robots } = config;
  if (sitemap !== undefined) {
    routes.push({
      method: "GET",
      path: "/sitemap.xml",
      mount: "root",
      public: true,
      // Reached through the root rewrite, whose request names the handler's
      // own path: the root address is the one the index names.
      handler: (req, ctx) =>
        sitemapResponse(req, ctx, { ...config, sitemap }, "/sitemap.xml"),
    });
  }
  if (robots !== undefined) {
    routes.push({
      method: "GET",
      path: "/robots.txt",
      mount: "root",
      public: true,
      handler: async (req, ctx) => {
        const { origin, headers } = await originOf(
          req,
          ctx,
          config,
          "text/plain; charset=utf-8"
        );
        // The site's own choice where it has made one, else the plugin's.
        const { aiCrawlers, robotsRules, robotsRulesRefused } =
          await config.readRules(ctx, undefined);
        if (robotsRulesRefused !== undefined) {
          warnOnce(
            `The SEO settings' own robots.txt rules are not served: ${robotsRulesRefused} Save them again on Settings, Search engines and AI.`,
            message => ctx.logger.warn(message)
          );
        }
        const body = robotsTxt({
          aiCrawlers: aiCrawlers ?? robots.aiCrawlers,
          ...(sitemap === undefined
            ? {}
            : { sitemap: `${origin}/sitemap.xml` }),
          ...(robotsRules === undefined ? {} : { ownRules: robotsRules.text }),
          // Stored with the own rules, so it is ticked or not with them.
          ...(robotsRules?.contentSignal === true
            ? { contentSignal: true }
            : {}),
        });
        // Says the file is the plugin's, so the settings screen can tell a
        // site that serves its own robots.txt instead.
        return new Response(body, {
          headers: { ...headers, [ROBOTS_SERVED_BY_HEADER]: "plugin-seo" },
        });
      },
    });
  }
  routes.push(...feedRoutes(config));
  routes.push(
    llmsRoute(
      "/llms.txt",
      "list of pages",
      config,
      rules => rules.llmsTxt === true,
      llmsTxtOf
    ),
    // Every listed page's words in one file: only beside llms.txt.
    llmsRoute(
      "/llms-full.txt",
      "file of every page",
      config,
      rules => rules.llmsTxt === true && rules.llmsFullTxt === true,
      (ctx, origin, outputs, rules) =>
        llmsFullTxtOf(ctx, origin, outputs, rules)
    ),
    // A folder's own files, at the addresses `withNextly` sends
    // `/<folder>/llms.txt` and `/<folder>/llms-full.txt` to.
    llmsRoute(
      `${LLMS_FILE_PREFIX}/:section/llms.txt`,
      "list of pages",
      config,
      rules => rules.llmsTxt === true,
      (ctx, origin, outputs, rules, folder) =>
        llmsTxtOf(ctx, origin, outputs, rules, folder)
    ),
    llmsRoute(
      `${LLMS_FILE_PREFIX}/:section/llms-full.txt`,
      "file of every page",
      config,
      rules => rules.llmsTxt === true && rules.llmsFullTxt === true,
      (ctx, origin, outputs, rules, folder) =>
        llmsFullTxtOf(ctx, origin, outputs, rules, undefined, folder)
    )
  );
  return routes;
}

/**
 * Where `withNextly` sends a folder's llms files behind the API handler:
 * the address under `LLMS_FILE_ROUTE_PREFIX` of `nextly/next`, which is
 * `/llms-files`.
 */
const LLMS_FILE_PREFIX = "/llms-files";

/**
 * A route serving one of the llms files, only once switched on in the SEO
 * settings, so it is not found until then; it lists what the sitemap lists,
 * narrowed as it is. A route under {@link LLMS_FILE_PREFIX} serves a
 * folder's file, the folder the route caught, and is not found for a folder
 * the settings give no files of its own. No copy of it is kept to serve
 * while the address record catches up: it carries pages' titles,
 * descriptions or words, which a kept copy would go on serving after the
 * public may no longer read them.
 */
function llmsRoute(
  path: string,
  what: string,
  config: RootFilesConfig,
  on: (rules: SiteRules) => boolean,
  write: (
    ctx: PluginRouteContext,
    origin: string,
    outputs: AiOutputsConfig,
    rules: SiteRules,
    folder?: string
  ) => Promise<string | null>
): PluginRoute {
  return {
    method: "GET",
    path,
    mount: "root",
    public: true,
    handler: async (req, ctx) => {
      const rules = await config.readRules(ctx, undefined);
      if (!on(rules)) return notFound();
      const { section } = ctx.params;
      if (section !== undefined && !servesFolderFiles(rules, section)) {
        return notFound();
      }
      const waiting = await catchingUp(ctx, what, undefined);
      if (waiting !== null) return waiting;
      const { origin, headers } = await originOf(
        req,
        ctx,
        config,
        "text/plain; charset=utf-8"
      );
      const body = await write(
        ctx,
        origin,
        {
          readRules: config.readRules,
          ...(config.codeRoutes === undefined
            ? {}
            : { codeRoutes: config.codeRoutes }),
          ...(config.codeMarkdown === undefined
            ? {}
            : { codeMarkdown: config.codeMarkdown }),
          ...(config.sitemap?.collections === undefined
            ? {}
            : { collections: config.sitemap.collections }),
          ...(config.feeds === undefined ? {} : { feeds: config.feeds }),
        },
        rules,
        section
      );
      return answered(ctx, undefined, body, headers);
    },
  };
}

/**
 * Where `withNextly` sends a feed's address behind the API handler: the
 * address under `FEED_FILE_ROUTE_PREFIX` of `nextly/next`, which is
 * `/feed-files`.
 */
const FEED_FILE_PREFIX = "/feed-files";

/**
 * How long a reader, and a cache between, may keep a feed: five minutes, so
 * the many readers polling a feed are answered from a cache, and a page
 * published, changed or taken down shows within that.
 */
const FEED_CACHE = "public, max-age=300, s-maxage=300";

/**
 * The routes serving the site's feeds: both shapes of address `withNextly`
 * rewrites (`/feed.xml`, `/<folder>/feed.xml`), each answering the feed the
 * options name at the address asked for, and not found where none is. None
 * where the options name no feed. No copy of a feed is kept to serve while
 * the address record catches up: it carries pages' titles and descriptions,
 * which a kept copy would go on serving after the public may no longer read
 * them.
 */
function feedRoutes(config: RootFilesConfig): PluginRoute[] {
  const feeds = config.feeds ?? [];
  if (feeds.length === 0) return [];
  const byPath = new Map(feeds.map(feed => [feed.path, feed]));
  const handler: PluginRoute["handler"] = async (req, ctx) => {
    // The address the site was asked for, from the folder the route caught.
    const { section } = ctx.params;
    const feed = byPath.get(
      section === undefined ? "/feed.xml" : `/${section}/feed.xml`
    );
    if (feed === undefined) return notFound();
    const waiting = await catchingUp(ctx, "feed", undefined);
    if (waiting !== null) return waiting;
    const { origin, headers, own } = await originOf(
      req,
      ctx,
      config.feedOrigin === undefined
        ? config
        : { ...config, origin: config.feedOrigin },
      "application/rss+xml; charset=utf-8"
    );
    const body = await feedXmlOf(ctx, feed, {
      origin,
      readRules: config.readRules,
      ...(config.readStructuredDataRules === undefined
        ? {}
        : { readStructuredDataRules: config.readStructuredDataRules }),
    });
    // Kept by caches only for the site's own origin: an answer naming the
    // host a request named is never kept (`originOf`).
    return new Response(body, {
      headers: own ? { ...headers, "cache-control": FEED_CACHE } : headers,
    });
  };
  return [
    `${FEED_FILE_PREFIX}/feed.xml`,
    `${FEED_FILE_PREFIX}/:section/feed.xml`,
  ].map(path => ({
    method: "GET" as const,
    path,
    mount: "root" as const,
    public: true,
    handler,
  }));
}
