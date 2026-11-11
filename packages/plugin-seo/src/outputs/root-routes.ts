/**
 * The routes that serve the site's `/sitemap.xml` and `/robots.txt` at its
 * root. `withNextly` rewrites both to the API handler, and a site that ships
 * its own file keeps serving it.
 *
 * @module outputs/root-routes
 */
import type { PluginRoute, PluginRouteContext } from "@nextlyhq/plugin-sdk";

import {
  addressRecordReady,
  retryFailedCatchUp,
} from "../address-record/catch-up";
import { productionAddressesOf } from "../canonical";
import type { ReadRules } from "../resolver/provider";

import { listPages } from "./listing";
import { robotsTxt, type AiCrawlerChoice } from "./robots";
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
  /** Whether the sitemap is served, and what it lists and splits by. */
  sitemap?: { collections?: readonly string[]; limits: SitemapLimits };
  /** Whether robots.txt is served, and what it asks AI crawlers. */
  robots?: { aiCrawlers: AiCrawlerChoice };
}

/**
 * The site's origin for one request, and the headers that follow from it:
 * one of the site's production addresses, as the page's head reads them, the
 * one the request reached where it is among them; else the configured
 * origin; else the request's own, which nothing may cache, since a request's
 * host can be anything its sender says.
 */
async function originOf(
  req: Request,
  ctx: PluginRouteContext,
  config: RootFilesConfig,
  contentType: string
): Promise<{ origin: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = { "content-type": contentType };
  const asked = new URL(req.url).origin;
  const production = productionAddressesOf(
    (await config.readRules(ctx, undefined)).productionAddresses
  );
  const site =
    production.find(address => address === asked) ??
    production[0] ??
    config.origin;
  if (site !== undefined) return { origin: site, headers };
  headers["cache-control"] = "no-store";
  return { origin: asked, headers };
}

const notFound = () => new Response("Not found", { status: 404 });

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
  // While the address record catches up, or after a catch-up that failed, a
  // page may not hold its address yet, and a sitemap read now would leave it
  // out: crawlers are asked to come back, nothing in between keeps the
  // answer, and a failed catch-up is tried again.
  if (!addressRecordReady()) {
    retryFailedCatchUp();
    return new Response("The sitemap is being brought up to date.", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "120" },
    });
  }
  const { origin, headers } = await originOf(
    req,
    ctx,
    config,
    "application/xml; charset=utf-8"
  );
  const { pages } = await listPages(ctx, {
    origin,
    readRules: config.readRules,
    ...(config.sitemap.collections === undefined
      ? {}
      : { collections: config.sitemap.collections }),
  });
  const body = sitemapAnswer(pages, {
    sitemap: `${origin}${at ?? url.pathname}`,
    limits: config.sitemap.limits,
    ...(asked === null ? {} : { page: Number(asked) }),
  });
  return body === null ? notFound() : new Response(body, { headers });
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
        const { aiCrawlers } = await config.readRules(ctx, undefined);
        const body = robotsTxt({
          aiCrawlers: aiCrawlers ?? robots.aiCrawlers,
          ...(sitemap === undefined
            ? {}
            : { sitemap: `${origin}/sitemap.xml` }),
        });
        return new Response(body, { headers });
      },
    });
  }
  return routes;
}
