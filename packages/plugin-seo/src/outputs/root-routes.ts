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
import type { CodeRoute } from "../code-pages/routes";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
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
  codeRoutes?: () => readonly CodeRoute[];
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
        });
        // Says the file is the plugin's, so the settings screen can tell a
        // site that serves its own robots.txt instead.
        return new Response(body, {
          headers: { ...headers, [ROBOTS_SERVED_BY_HEADER]: "plugin-seo" },
        });
      },
    });
  }
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
      llmsFullTxtOf
    )
  );
  return routes;
}

/**
 * A route serving one of the llms files, only once switched on in the SEO
 * settings, so it is not found until then; it lists what the sitemap lists,
 * narrowed as it is.
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
    rules: SiteRules
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
      const site = await originOf(
        req,
        ctx,
        config,
        "text/plain; charset=utf-8"
      );
      const { origin, headers } = site;
      const file = fileName(path, site);
      const waiting = await catchingUp(ctx, what, file);
      if (waiting !== null) return waiting;
      const body = await write(
        ctx,
        origin,
        {
          readRules: config.readRules,
          ...(config.codeRoutes === undefined
            ? {}
            : { codeRoutes: config.codeRoutes }),
          ...(config.sitemap?.collections === undefined
            ? {}
            : { collections: config.sitemap.collections }),
        },
        rules
      );
      return answered(ctx, file, body, headers);
    },
  };
}
