/**
 * `@nextlyhq/plugin-seo` — the first-party SEO plugin for Nextly.
 *
 * Opt-in and framework-agnostic (zero `next` dependency): it adds an SEO field
 * group to the collections you name, so it stays usable in every deployment
 * mode (integrated site, headless, internal admin).
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import {
  definePlugin,
  group,
  type FieldConfig,
  type PluginContributions,
  type PluginDefinition,
  type PluginRoute,
} from "@nextlyhq/plugin-sdk";

import { startCatchUp } from "./address-record/catch-up";
import { addressRecordCollection } from "./address-record/collection";
import {
  addressRecord,
  releaseOnCollectionDelete,
} from "./address-record/participant";
import { bulkRoutes } from "./bulk/route";
import { defaultSeoFields } from "./fields";
import { importRoutes } from "./import/route";
import { withLanguageLinks } from "./languages/head";
import { notFoundCollection } from "./not-found/collection";
import { keepSeoContext } from "./not-found/report";
import { listPages, type ListedPagesService } from "./outputs/listing";
import type { AiCrawlerChoice } from "./outputs/robots";
import {
  rootFileRoutes,
  sitemapResponse,
  type RootFilesConfig,
} from "./outputs/root-routes";
import {
  EMPTY_SITEMAP_BYTES,
  SITEMAP_LIMITS,
  type SitemapLimits,
} from "./outputs/sitemap-files";
import { PROBLEMS_PAGE, PROBLEMS_PAGE_HREF } from "./problems/contract";
import { watchSaves } from "./problems/hooks";
import { problemRoutes } from "./problems/route";
import { problemsCollection } from "./problems/store";
import { redirectsCollection } from "./redirects/collection";
import { redirectsProxyHandler } from "./redirects/proxy-handler";
import { seoPageMetadata, type ReadRules } from "./resolver/provider";
import {
  contentTypesRoute,
  settingsDocumentRoute,
} from "./settings/content-types-route";
import {
  SEO_SETTINGS_SLUG,
  SETTINGS_PAGE,
  SETTINGS_PAGE_HREF,
} from "./settings/contract";
import { readSeoRules, rememberSettingsSingle } from "./settings/rules";
import { seoSettingsSingle } from "./settings/single";
import { socialCardFromSettings } from "./settings/social-card-rules";
import { structuredDataFromSettings } from "./settings/structured-data-rules";
import {
  resolveBaseOrigin,
  type SitemapOptions,
  type UrlForEntry,
} from "./sitemap";
import {
  socialCardRulesFromOptions,
  withSocialCard,
  type SocialCardOptions,
} from "./social/card";
import { shareImageRoute } from "./social/route";
import { decideStanding, stagingGuard } from "./staging/guard";
import { withStructuredData } from "./structured-data/provider";
import {
  checkedTypeRules,
  rulesFromOptions,
  type StructuredDataOptions,
} from "./structured-data/rules";
import { seoTabParts } from "./tab/install";
import { seoIssuesAttentionItems, seoIssuesWidget } from "./widget-card";

// Read the version from package.json so the plugin's declared version can never
// drift from what actually ships (mirrors @nextlyhq/plugin-form-builder).
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

export interface SeoPluginOptions {
  /**
   * The collections to extend with the SEO field group. SEO is added ONLY to
   * these — collections you do not name are untouched.
   */
  collections: string[];
  /**
   * The Singles to extend with the SEO field group, such as a homepage. None
   * when absent. A Single's page gets the same SEO tab a collection's has.
   */
  singles?: string[];
  /**
   * The fields placed INSIDE the `seo` group. Defaults to
   * {@link defaultSeoFields}. Custom fields are still nested under `seo` (e.g. a `focusKeyword`
   * override lands at `entry.seo.focusKeyword`), so consumers always read SEO
   * data from one predictable place.
   */
  fields?: FieldConfig[];
  /**
   * The site's production origin (e.g. "https://example.com", no trailing
   * slash): every address the sitemap lists, and the sitemap's address in
   * robots.txt, are made absolute against it. When omitted, each request's own
   * origin is used — correct for a single-origin deployment, but wrong behind
   * a proxy that rewrites the host, so set it explicitly there.
   */
  baseUrl?: string;
  /**
   * @deprecated The sitemap lists each page at the public address its content
   * type declares (`publicAddress`), the same address its canonical names, so
   * this no longer shapes it. Declare `publicAddress` on the collection
   * instead. `buildSitemapUrls` still reads it.
   */
  urlFor?: UrlForEntry;
  /**
   * @deprecated As {@link SeoPluginOptions.urlFor}: the sitemap lists each
   * page at the address its content type declares (`publicAddress`).
   * `buildSitemapUrls` still reads it. Typed from {@link SitemapOptions}, which
   * it is passed to unchanged.
   */
  basePath?: SitemapOptions["basePath"];
  /**
   * Controls the sitemap, served at `/sitemap.xml`. `true` (the default) lists
   * every published page of each content type that declares a public address,
   * Singles included. `false` serves none. Pass `{ collections: [...] }` to
   * list only those collections' pages.
   *
   * Past `maxUrlsPerFile` addresses or `maxBytesPerFile` bytes (the protocol's
   * 50,000 and 50 MB by default, and never more), `/sitemap.xml` is a sitemap
   * index naming each file as `/sitemap.xml?page=<n>`.
   *
   * The sitemap is PUBLIC and lists every published page's address, read as
   * the system, so it bypasses per-collection read access. A content type
   * that declares a public address states that its pages are public; narrow
   * this list, or hide the type, for any that should not be enumerable.
   */
  sitemap?:
    | boolean
    | {
        collections?: string[];
        maxUrlsPerFile?: number;
        maxBytesPerFile?: number;
      };
  /**
   * @experimental Serve `/robots.txt`. On by default. It lets search engines
   * read every page but the admin, asks AI crawlers what `aiCrawlers` says,
   * and names the sitemap by its absolute address.
   */
  robots?: boolean;
  /**
   * @experimental What robots.txt asks AI crawlers: `"all"` (the default)
   * lets every one read the site; `"search"` asks those that collect pages to
   * train AI models to stay away, while tools that answer questions may still
   * read and cite pages; `"block"` asks every known one to stay away. These
   * are requests that crawlers may ignore. Asking Google not to train
   * (`Google-Extended`) also limits what Gemini can use; Google Search is not
   * affected by any of them.
   */
  aiCrawlers?: AiCrawlerChoice;
  /**
   * @experimental Content types hidden from search as a whole: every page of
   * one is served `noindex` and left out of the sitemap, whatever the page's
   * own setting, and returns to its own setting once the type is shown again.
   * A collection's slug, such as `"tags"`, or `"single:<slug>"` for a Single.
   */
  hiddenTypes?: string[];
  /**
   * @experimental Each content type's structured data type, the fields that
   * hold each detail it needs, and the brand facts every page names, until the
   * SEO settings hold them. Keyed by collection slug, or `single:<slug>`:
   *
   * ```ts
   * seoPlugin({
   *   collections: ["posts"],
   *   baseUrl: "https://example.com",
   *   structuredData: {
   *     brand: { name: "Example", profiles: [{ url: "https://x.com/example" }] },
   *     types: {
   *       posts: {
   *         type: "blogPosting",
   *         details: { blogPosting: { author: "writer", datePublished: "date" } },
   *       },
   *     },
   *   },
   * });
   * ```
   *
   * Structured data is written with absolute addresses, so `baseUrl` is
   * needed for any to be served.
   */
  structuredData?: StructuredDataOptions;
  /**
   * @experimental What every page's social card states beyond the page:
   * the site's name, until one is saved in the SEO settings, and the
   * language of a page the route read in no particular language, as a
   * language tag.
   *
   * ```ts
   * seoPlugin({
   *   collections: ["posts"],
   *   baseUrl: "https://example.com",
   *   socialCard: { siteName: "Example", language: "en-US" },
   * });
   * ```
   *
   * A share image stored with a path from the root is stated on the site's
   * production address, else on `baseUrl`, since a network reading the card
   * needs its full address.
   */
  socialCard?: SocialCardOptions;
}

/**
 * A file-size option: a positive whole number, at least `least`, no larger
 * than the protocol allows.
 */
function fileLimit(
  name: string,
  value: number | undefined,
  limits: { protocol: number; least: number }
): number {
  if (value === undefined) return limits.protocol;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `seoPlugin: sitemap.${name} must be a positive whole number, got: ${value}`
    );
  }
  if (value < limits.least) {
    throw new Error(
      `seoPlugin: sitemap.${name} must be at least ${limits.least}, the size of an empty file, got: ${value}`
    );
  }
  return Math.min(value, limits.protocol);
}

/** The limits one sitemap file is held to. */
function sitemapLimits(sitemap: SeoPluginOptions["sitemap"]): SitemapLimits {
  const options = typeof sitemap === "object" ? sitemap : {};
  return {
    urls: fileLimit("maxUrlsPerFile", options.maxUrlsPerFile, {
      protocol: SITEMAP_LIMITS.urls,
      least: 1,
    }),
    bytes: fileLimit("maxBytesPerFile", options.maxBytesPerFile, {
      protocol: SITEMAP_LIMITS.bytes,
      least: EMPTY_SITEMAP_BYTES,
    }),
  };
}

/**
 * The collections `sitemap.collections` narrows the sitemap to, where it
 * does. Each must be one of the SEO collections: a slug outside them is
 * never extended, so a typo would only surface at request time, and is
 * refused at construction instead.
 */
function subsetOf(
  sitemap: SeoPluginOptions["sitemap"],
  targets: readonly string[]
): string[] | undefined {
  if (typeof sitemap !== "object" || sitemap.collections === undefined) {
    return undefined;
  }
  const subset = [...new Set(sitemap.collections)];
  const unknown = subset.filter(slug => !targets.includes(slug));
  if (unknown.length > 0) {
    throw new Error(
      `seoPlugin: sitemap.collections must be a subset of collections; ` +
        `unknown: ${unknown.join(", ")}`
    );
  }
  return subset;
}

/**
 * The site's rules as every page's head, the sitemap, robots.txt and the
 * staging guard read them alike: the SEO settings, with the plugin's hidden
 * types answering where the settings name none, so a hidden type is hidden in
 * every output and one production address answers for all of them. The
 * robots.txt route falls back to the plugin's own AI crawler option.
 */
function rulesReader(options: { hiddenTypes?: readonly string[] }): ReadRules {
  const hiddenTypes = [...new Set(options.hiddenTypes ?? [])];
  return async (ctx, locale) => {
    const saved = await readSeoRules(ctx, locale);
    return {
      ...saved,
      ...(saved.hiddenTypes === undefined && hiddenTypes.length > 0
        ? { hiddenTypes }
        : {}),
    };
  };
}

/** What the sitemap is served with, or nothing where it is turned off. */
function sitemapConfig(
  options: SeoPluginOptions,
  collections: readonly string[] | undefined
): RootFilesConfig["sitemap"] {
  if (options.sitemap === false) return undefined;
  return {
    limits: sitemapLimits(options.sitemap),
    ...(collections === undefined ? {} : { collections }),
  };
}

/**
 * What the site's root files are served with. A configured baseUrl must be an
 * absolute http(s) origin, or every listed address is invalid: checked at
 * construction so a typo fails at boot, and only where the sitemap, which
 * robots.txt names by it, is served.
 */
function rootFilesConfig(
  options: SeoPluginOptions,
  readRules: ReadRules,
  collections: readonly string[] | undefined
): RootFilesConfig {
  const sitemap = sitemapConfig(options, collections);
  const origin =
    sitemap !== undefined && options.baseUrl !== undefined
      ? resolveBaseOrigin(options.baseUrl)
      : undefined;
  return {
    ...(origin === undefined ? {} : { origin }),
    readRules,
    ...(sitemap === undefined ? {} : { sitemap }),
    ...(options.robots === false
      ? {}
      : { robots: { aiCrawlers: options.aiCrawlers ?? "all" } }),
  };
}

/**
 * The routes serving the site's sitemap and robots.txt at its root, and the
 * sitemap again at the plugin's own address, where sites served it from
 * before it reached the root.
 */
function siteFileRoutes(
  options: SeoPluginOptions,
  readRules: ReadRules,
  collections: readonly string[] | undefined
): PluginRoute[] {
  const config = rootFilesConfig(options, readRules, collections);
  const routes = rootFileRoutes(config);
  const { sitemap } = config;
  if (sitemap !== undefined) {
    routes.push({
      method: "GET",
      path: "/sitemap.xml",
      public: true,
      handler: (req, ctx) => sitemapResponse(req, ctx, { ...config, sitemap }),
    });
  }
  return routes;
}

/**
 * Create the SEO plugin. Register it directly in your config — no unwrapping:
 *
 * @example
 * ```ts
 * import { defineConfig } from "nextly/config";
 * import { seoPlugin } from "@nextlyhq/plugin-seo";
 *
 * export default defineConfig({
 *   plugins: [seoPlugin({ collections: ["pages", "posts"] })],
 * });
 * ```
 */
export function seoPlugin(options: SeoPluginOptions): PluginDefinition {
  // Always nest the fields (default or custom) under a single `seo` group so
  // every project exposes SEO consistently at `entry.seo.*`.
  const seoFields = options.fields ?? defaultSeoFields();
  const seoGroup = group({
    name: "seo",
    label: "SEO",
    fields: seoFields,
    // Kept per language wherever the content is translated, so each language
    // has its own title, description and canonical; on a type that is not
    // translated, one value as before.
    localized: true,
  });

  // Dedupe once: a repeated slug would make the schema-extend fold add `seo`
  // twice (a duplicate-field error), and would list the same URLs twice in the
  // sitemap.
  const targets = [...new Set(options.collections)];
  const singleTargets = [...new Set(options.singles ?? [])];

  const sitemapSubset = subsetOf(options.sitemap, targets);
  const readRules = rulesReader(options);

  // Checked here, so a misspelled type or detail fails when the site starts.
  const readStructuredDataRules = rulesFromOptions(
    options.baseUrl,
    options.structuredData
  );
  const readSocialCardRules = socialCardFromSettings(
    socialCardRulesFromOptions(options.baseUrl, options.socialCard)
  );

  // The SEO tab on each page the group is added to, and the route it reads
  // a page's automatic values from.
  const tab = seoTabParts({
    collections: targets,
    singles: singleTargets,
    fields: seoFields,
    baseUrl: options.baseUrl,
    readRules,
    readStructuredDataRules,
    readSocialCardRules,
  });

  // What the problem list checks, read with the rules every page's head is
  // worked out by, so the list and the page never disagree.
  const problemChecks = {
    targets,
    readers: {
      readRules,
      readStructuredDataRules: structuredDataFromSettings(
        readStructuredDataRules
      ),
      readSocialCardRules,
    },
  };

  // The site's sitemap and robots.txt, the action that makes a share image
  // of the right size, the SEO tab's own and the problem list's; all added
  // below.
  const routes: PluginRoute[] = [];

  const contributes: PluginContributions = {
    // Add the SEO group to each named collection.
    extend: [{ target: [...targets, ...singleTargets], fields: [seoGroup] }],
    // The record that keeps each public address to one page, the redirects
    // whose From addresses it holds, the log of addresses not found, and
    // what the problem list's checks found.
    collections: [
      addressRecordCollection(),
      redirectsCollection(),
      notFoundCollection(),
      problemsCollection(),
    ],
    // Every page's head, worked out by the one order of who wins, with its
    // links to its other languages, its social card completed, and its
    // structured data, worked out from that same answer and the settings'
    // brand facts, with the plugin's options where the settings say nothing.
    services: {
      pageMetadata: ctx =>
        withStructuredData(
          ctx,
          withSocialCard(
            ctx,
            withLanguageLinks(ctx, seoPageMetadata(ctx, readRules), readRules),
            readSocialCardRules
          ),
          structuredDataFromSettings(readStructuredDataRules)
        ),
      // The pages the site lists and the problems that left any out, read by
      // the same rules as the head: one reading for every listing output.
      listedPages: (ctx): ListedPagesService => ({
        list: (origin: string) =>
          listPages(ctx, {
            origin,
            readRules,
            ...(sitemapSubset === undefined
              ? {}
              : { collections: sitemapSubset }),
          }),
      }),
    },
    routes,
    // Every host but the site's production addresses is kept out of search,
    // and redirects answer before the page is served. Only a redirect
    // answers, so the order changes nothing a visitor gets.
    proxy: [stagingGuard(readRules), redirectsProxyHandler()],
    // The site-wide SEO settings: name, defaults, patterns and brand facts.
    singles: [seoSettingsSingle()],
    // The SEO settings screen, for whoever may read the settings, told what
    // the plugin's options answer until the site chooses: what robots.txt
    // asks AI tools and which types are hidden, which the site's own
    // robots.txt and pages already say.
    admin: {
      ...tab.admin,
      clientConfig: {
        aiCrawlers: options.aiCrawlers ?? "all",
        hiddenTypes: [...new Set(options.hiddenTypes ?? [])],
        // Each type's structured data choice the options make, which the
        // screen shows until the site chooses its own.
        structuredData: checkedTypeRules(options.structuredData?.types),
      },
      menu: [
        // Shown to everyone in the admin: the list answers each person with
        // the pages of the types they may read, and says so where none.
        { label: "Problems", to: PROBLEMS_PAGE_HREF, icon: "AlertTriangle" },
        {
          label: "Settings",
          to: SETTINGS_PAGE_HREF,
          icon: "Settings",
          requiredPermission: `read-${SEO_SETTINGS_SLUG}`,
        },
      ],
      pages: [
        PROBLEMS_PAGE,
        { ...SETTINGS_PAGE, requiredPermission: `read-${SEO_SETTINGS_SLUG}` },
      ],
    },
  };

  // The SEO issues card and its Needs attention lines, one per collection,
  // all counting the issues in those same collections. Bound to `targets`
  // rather than to every collection: a collection this plugin never extended
  // has no `seo` group, so every one of its documents would report the full
  // set of missing fields and drown the real answer. Each is withheld where it
  // would have nothing to say (see `widget-card`).
  const issuesCard = seoIssuesWidget(targets, seoFields);
  const issuesItems = seoIssuesAttentionItems(targets, seoFields);
  if (issuesCard || issuesItems.length > 0) {
    contributes.dashboard = {
      ...(issuesCard ? { widgets: [issuesCard] } : {}),
      ...(issuesItems.length > 0 ? { attention: issuesItems } : {}),
    };
  }

  routes.push(
    ...siteFileRoutes(options, readRules, sitemapSubset),
    shareImageRoute(options.baseUrl),
    // What the settings screen reads: the types SEO is added to, and which
    // Single holds the settings.
    contentTypesRoute(targets),
    settingsDocumentRoute(),
    ...tab.routes,
    ...problemRoutes(problemChecks),
    // The bulk edit table, and the import beside it.
    ...bulkRoutes({ targets, readRules, checks: problemChecks }),
    ...importRoutes({ targets, readRules, checks: problemChecks })
  );

  return definePlugin({
    name: "@nextlyhq/plugin-seo",
    version: PLUGIN_VERSION,
    // Core-compat range (the field is literally `nextly`), DERIVED from the
    // version this plugin ships at rather than typed.
    //
    // 🔴 A hand-written floor goes stale the moment the plugin starts using
    // something newer, and the staleness is silent in the direction that
    // accepts: an older core satisfying the wider range is installed, does not
    // read the `contributes.dashboard` this plugin declares in the shape it
    // declares it, and the card and its Needs attention line silently never
    // appear. The floor stood at alpha.55 -- the
    // release that first exported `slugToStaticParam` -- while this plugin had
    // begun requiring a contract that shipped much later.
    //
    // Every package in this repository releases at ONE version, so the core
    // published beside this plugin always carries exactly what it was built
    // against. Naming that version is therefore both the tightest honest floor
    // and one that cannot fall behind, because it is the same string the
    // package already reads for its own `version`.
    nextly: `>=${PLUGIN_VERSION}`,
    author: "Nextly <contact@nextlyhq.com> (https://nextlyhq.com)",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    // How the plugin presents itself wherever the admin lists it. Without a
    // description the plugins list shows a bare name, which says nothing about
    // what installing this does. The other first-party plugins declare theirs
    // in the same place.
    admin: {
      // Its own place in the admin's rail, after Media, as SEO.
      placement: "standalone",
      after: "media",
      appearance: { icon: "Search", label: "SEO" },
      description:
        "Add an SEO meta field group to your collections, with title, description and social preview fields",
    },
    category: "seo",
    tags: ["seo", "meta"],
    // The route helpers ask this plugin for each page's head.
    provides: ["page-metadata"],
    contributes,
    init(ctx) {
      // The settings Single's registered name, for readers other plugins call.
      rememberSettingsSingle(ctx);
      if (options.urlFor !== undefined || options.basePath !== undefined) {
        ctx.logger.warn(
          "seoPlugin: urlFor and basePath no longer shape the sitemap, which lists each page at the address its content type declares. Declare publicAddress on each public collection instead."
        );
      }
      // The site-wide record that keeps each public address to one page:
      // asked on every save, and told what each document holds after it.
      ctx.publicAddresses.participate(addressRecord(ctx));
      releaseOnCollectionDelete(ctx);
      // Kept for the site's not-found page, which logs through it.
      keepSeoContext(ctx);
      // Each saved page checked again for the problem list.
      watchSaves(ctx, problemChecks);
    },
    onReady(ctx) {
      // Started, not awaited: it waits for the boot to finish, and brings the
      // record up to date with content saved while the plugin was absent or
      // addresses a deploy moved.
      void startCatchUp(ctx);
      // Decided once, the first time the plugin starts on a site: whether a
      // site with no production address known is kept out of search.
      void decideStanding(ctx).catch((error: unknown) => {
        ctx.logger.error(
          "The SEO plugin could not record the site's standing",
          {
            error,
          }
        );
      });
    },
  });
}
