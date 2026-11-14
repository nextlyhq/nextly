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
  EXTENSION_SWITCH_SERVICE,
  group,
  isSecret,
  NextlyError,
  type ExtensionSwitch,
  type FieldConfig,
  type PageMetadataResolver,
  type PluginContext,
  type PluginContributions,
  type PluginDefinition,
  type PluginRoute,
  type Secret,
} from "@nextlyhq/plugin-sdk";

import {
  forgetCatchUpFingerprint,
  lastCatchUp,
  startCatchUp,
} from "./address-record/catch-up";
import { addressRecordCollection } from "./address-record/collection";
import {
  ADDRESSES_MOVED,
  REDIRECTS_CHANGED,
  addressRecord,
  releaseOnCollectionDelete,
} from "./address-record/participant";
import { startRecheck } from "./address-record/recheck";
import {
  ADDRESS_RECORD_CACHE_PART,
  ADDRESS_RECORD_CHANGED,
  prepareRecordMove,
  recordReady,
} from "./address-record/store";
import { BULK_PAGE } from "./bulk/contract";
import { bulkRoutes } from "./bulk/route";
import { codePagesCollection } from "./code-pages/collection";
import {
  keepCodeRoutes,
  withCodePageConnections,
} from "./code-pages/connections";
import { PAGES_PAGE, PAGES_PAGE_HREF } from "./code-pages/contract";
import { codePageRoutes } from "./code-pages/route";
import { readCodeRoutes, type CodeRoute } from "./code-pages/routes";
import { codeAddressOf } from "./code-pages/store";
import {
  indexNowKeyProxyHandler,
  watchForIndexNow,
} from "./connections/indexnow";
import { INDEXNOW_HOST } from "./connections/indexnow-send";
import { searchConsoleRoutes } from "./connections/search-console";
import {
  SEARCH_CONSOLE_HOSTS,
  type GoogleClient,
} from "./connections/search-console-send";
import { CONNECTION_SECRETS, connectionSettings } from "./connections/store";
import { watchContentDates } from "./content-dates/hooks";
import { defaultSeoFields } from "./fields";
import { importRoutes } from "./import/route";
import { withLanguageLinks } from "./languages/head";
import { notFoundCollection } from "./not-found/collection";
import { moveLoggedRows } from "./not-found/log";
import { keepSeoContext } from "./not-found/report";
import { plainCopyProxyHandler } from "./outputs/ai-outputs";
import { listPages, type ListedPagesService } from "./outputs/listing";
import type { AiCrawlerChoice } from "./outputs/robots";
import { siteServesOwnRobots } from "./outputs/robots-owner";
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
import { withVerification } from "./outputs/verification";
import { checklistRoutes } from "./overview/checklist";
import {
  IMPORT_PAGE,
  INSPECT_PAGE,
  OVERVIEW_PAGE,
  OVERVIEW_PAGE_HREF,
} from "./overview/contract";
import {
  CHECK_SEO_PERMISSION,
  holdsPageSeo,
  MANAGE_SEO_PERMISSION,
  seoPermissionDeclarations,
} from "./permissions";
import { problemsForCard } from "./problems/card-source";
import { PROBLEMS_PAGE, PROBLEMS_PAGE_HREF } from "./problems/contract";
import { watchSaves } from "./problems/hooks";
import { problemRoutes } from "./problems/route";
import { problemsCollection } from "./problems/store";
import { RECEIVED_PAGE } from "./received/contract";
import { receivedRoutes } from "./received/route";
import { verificationCheckRoute } from "./received/verification-check";
import { redirectsCollection } from "./redirects/collection";
import { REDIRECTS_PAGE, REDIRECTS_PAGE_HREF } from "./redirects/contract";
import { heldRedirectKeys } from "./redirects/held-keys";
import {
  redirectsProxyHandler,
  type GoneAnswerOptions,
} from "./redirects/proxy-handler";
import { redirectRoutes } from "./redirects/routes";
import { PAGE_BUILDER_PLUGIN } from "./resolver/design-level";
import type { SiteRules } from "./resolver/page-levels";
import { seoPageMetadata, type ReadRules } from "./resolver/provider";
import { withSeoOff } from "./resolver/seo-off";
import { routeValuesCollection } from "./route-values/collection";
import { withRouteValues } from "./route-values/record";
import { seoSchema, seoSchemaPlugin } from "./schema/definition";
import { seoExtendClauses, seoTypesOf, type SeoTypes } from "./seo-types";
import {
  contentTypesRoute,
  settingsDocumentRoute,
} from "./settings/content-types-route";
import { SETTINGS_PAGE, SETTINGS_PAGE_HREF } from "./settings/contract";
import {
  listingOrigins,
  robotsRulesCheckRoute,
  sitemapPaths,
} from "./settings/robots-rules-route";
import {
  readBrandFacts,
  readSeoRules,
  readVerificationTags,
  rememberSettingsSingle,
  setupWaiting,
} from "./settings/rules";
import { seoOffKeys, seoOffTypes } from "./settings/seo-off";
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
  type ReadStructuredDataRules,
  type StructuredDataOptions,
} from "./structured-data/rules";
import { seoTabParts } from "./tab/install";
import { SEO_GROUP } from "./tab/typed";
import { PAGE_BUILDER_TAB } from "./template/contributions";
import { seoTemplateRoute } from "./template/route";
import {
  SEO_PROBLEMS_ATTENTION_ID,
  seoIssuesSetup,
  seoIssuesWidget,
  seoProblemsAttentionItem,
} from "./widget-card";

// Read the version from package.json so the plugin's declared version can never
// drift from what actually ships (mirrors @nextlyhq/plugin-form-builder).
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

export interface SeoPluginOptions {
  /**
   * The collections to extend with the SEO field group, where the site names
   * its types. SEO is then added ONLY to these and to `singles`: types you do
   * not name are untouched.
   *
   * Leave both `collections` and `singles` out to add SEO to every collection
   * and Single the site defines, in code or in the Schema Builder, now or
   * later, and to a plugin's collection that holds the site's pages (such as
   * Page Builder's `pages`). Users, media and plugins' other collections never
   * get it. Removing a list moves a site to every type: run
   * `nextly migrate:create` and `nextly migrate` after.
   */
  collections?: string[];
  /**
   * The Singles to extend with the SEO field group, such as a homepage, where
   * the site names its types. None when absent and `collections` is given. A
   * Single's page gets the same SEO tab a collection's has.
   */
  singles?: string[];
  /**
   * @experimental Where the site names no `collections` or `singles`: types
   * to leave without SEO, by slug, such as an internal log. A type left out
   * before its first migration gets no SEO column; one left out later keeps
   * its column and values, unused, until `nextly prune` drops them.
   */
  exclude?: string[];
  /**
   * @experimental Where the site names no `collections` or `singles`: a
   * plugin's collections to add SEO to as well, by slug. For a plugin
   * collection whose pages are public but which its plugin does not mark as
   * the site's content; Page Builder's `pages` needs no entry here.
   */
  include?: string[];
  /**
   * The fields placed INSIDE the `seo` group. Defaults to
   * {@link defaultSeoFields}. Custom fields are still nested under `seo` (e.g. a `focusKeyword`
   * override lands at `entry.seo.focusKeyword`), so consumers always read SEO
   * data from one predictable place.
   */
  fields?: FieldConfig[];
  /**
   * Refuse a save of a title longer than 60 characters or a description
   * longer than 160, the lengths Google shows about as much of. Off by
   * default: search engines cut a longer one to fit rather than refusing it,
   * so a long value is saved and named as a warning in the SEO tab and the
   * problem list. Applies to the default fields; a site passing its own
   * `fields` sets `maxLength` on them itself.
   */
  hardLengthLimits?: boolean;
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
  /**
   * @experimental Give a page's SEO a permission of its own, one per content
   * type SEO is added to: `edit-seo-<slug>`, such as `edit-seo-posts`. A
   * role that may update a type's pages changes their SEO only while it also
   * holds that type's permission; without it the rest of each page is saved
   * and its SEO stays as it was, and the SEO tab shows it read-only.
   *
   * Off by default: whoever may edit a page changes its SEO, as before. The
   * built-in Editor and Author roles never hold a plugin's permissions, so a
   * site that turns this on gives the people who should change SEO a role
   * of its own that holds it. Admin and Super Admin hold every one.
   */
  pagePermissions?: boolean;
  /**
   * @experimental Where `next build` writes, relative to the app's
   * directory: `.next` unless the app's `next.config` sets `distDir`. The
   * pages the site's routes render from their own code are read from it,
   * for Pages and the sitemap.
   */
  nextBuildDir?: string;
  /**
   * @experimental The address of the site's own page to show for an address
   * made Gone on SEO › Redirects, such as `"/gone"`. The Proxy reads that
   * page and answers with it and status 410, so a visitor following an old
   * link sees the site's design; search engines read the status alone.
   * Without it, or where the page can't be read or doesn't answer 200, the
   * answer is a short plain page, with status 410 all the same. Keep the
   * page itself out of search: hide it on SEO › Pages.
   */
  gonePage?: string;
  /**
   * @experimental The Google sign-in Search Console is connected with, from
   * a Google Cloud OAuth client of the "Web application" kind. Without it,
   * the Connections tab says Search Console needs one. Keep the secret out
   * of the code: read it from the environment, wrapped in `secret()`.
   *
   * ```ts
   * seoPlugin({
   *   collections: ["posts"],
   *   searchConsole: {
   *     clientId: process.env.GOOGLE_CLIENT_ID ?? "",
   *     clientSecret: secret(process.env.GOOGLE_CLIENT_SECRET ?? ""),
   *   },
   * });
   * ```
   */
  searchConsole?: { clientId: string; clientSecret: string | Secret<string> };
}

/**
 * The value a client secret holds: wrapped in `secret()`, or as typed. A
 * wrapper made by another copy of the SDK than the plugin's, which a site
 * installing its own may load, is not an instance of the plugin's class, so
 * it is read by its `reveal()` too.
 */
function revealed(value: string | Secret<string>): unknown {
  if (isSecret(value)) return value.reveal();
  if (typeof value === "object" && value !== null) {
    const reveal: unknown = Reflect.get(value, "reveal");
    if (typeof reveal === "function") return Reflect.apply(reveal, value, []);
  }
  return value;
}

/** The Google sign-in `options` name, or none; a blank one is refused at boot. */
function googleClientOf(options: SeoPluginOptions): GoogleClient | undefined {
  const named = options.searchConsole;
  if (named === undefined) return undefined;
  const secretValue = revealed(named.clientSecret);
  const clientSecret = typeof secretValue === "string" ? secretValue : "";
  if (named.clientId.trim() === "" || clientSecret.trim() === "") {
    throw new Error(
      "seoPlugin: searchConsole needs both a clientId and a clientSecret"
    );
  }
  return { clientId: named.clientId.trim(), clientSecret };
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
  types: SeoTypes
): string[] | undefined {
  if (typeof sitemap !== "object" || sitemap.collections === undefined) {
    return undefined;
  }
  const subset = [...new Set(sitemap.collections)];
  // Every type's list is known only once the site starts, so only a named
  // list is checked here.
  if (!types.named) return subset;
  const unknown = subset.filter(slug => !types.collections.includes(slug));
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
function rulesReader(
  options: { hiddenTypes?: readonly string[] },
  types: Pick<SeoTypes, "keys">
): ReadRules {
  const hiddenTypes = [...new Set(options.hiddenTypes ?? [])];
  return async (ctx, locale) => {
    const saved = await readSeoRules(ctx, locale);
    // The switch read once for every output: only types with SEO can be
    // off, so a stale key is ignored by the head, the listings and the
    // problems alike, as the admin's switch ignores it.
    const { typesWithSeoOff: _saved, ...rest } = saved;
    const off = seoOffKeys(saved, types, message => ctx.logger.warn(message));
    return {
      ...rest,
      ...(off.length > 0 ? { typesWithSeoOff: off } : {}),
      ...(saved.hiddenTypes === undefined && hiddenTypes.length > 0
        ? { hiddenTypes }
        : {}),
    };
  };
}

/** What the sitemap lists, for the problem checks; nothing where it is off. */
function sitemapScopeOf(
  options: SeoPluginOptions,
  collections: readonly string[] | undefined
): { sitemap?: { collections?: readonly string[] } } {
  if (options.sitemap === false) return {};
  return { sitemap: collections === undefined ? {} : { collections } };
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
 * The configured origin, `{ origin }`, where the sitemap is served and a
 * baseUrl is set; nothing otherwise, so a baseUrl is checked only where the
 * sitemap, which robots.txt names by it, is served.
 */
function configuredOrigin(
  options: SeoPluginOptions,
  sitemap: RootFilesConfig["sitemap"]
): { origin?: string } {
  return sitemap !== undefined && options.baseUrl !== undefined
    ? { origin: resolveBaseOrigin(options.baseUrl) }
    : {};
}

/**
 * What the site's root files are served with. A configured baseUrl must be an
 * absolute http(s) origin, or every listed address is invalid: checked at
 * construction so a typo fails at boot, and only where the sitemap, which
 * robots.txt names by it, is served.
 */
function rootFilesConfig(
  options: SeoPluginOptions,
  readers: {
    readRules: ReadRules;
    readStructuredDataRules: ReadStructuredDataRules;
  },
  collections: readonly string[] | undefined,
  codeRoutes: () => readonly CodeRoute[]
): RootFilesConfig {
  const sitemap = sitemapConfig(options, collections);
  return {
    ...configuredOrigin(options, sitemap),
    ...readers,
    codeRoutes,
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
  readers: {
    readRules: ReadRules;
    readStructuredDataRules: ReadStructuredDataRules;
  },
  collections: readonly string[] | undefined,
  codeRoutes: () => readonly CodeRoute[]
): PluginRoute[] {
  const config = rootFilesConfig(options, readers, collections, codeRoutes);
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
 * The route behind "Block these N pages anyway": the sitemap listed at each
 * of the site's origins with the rules the draft reads by, and judged only
 * where the plugin serves both robots.txt and the sitemap.
 */
function ownRulesCheckRoute(
  options: SeoPluginOptions,
  readers: {
    readRules: ReadRules;
    readStructuredDataRules: ReadStructuredDataRules;
    codeRoutes: () => readonly CodeRoute[];
    sitemapSubset: readonly string[] | undefined;
  }
): PluginRoute {
  const { codeRoutes, sitemapSubset } = readers;
  return robotsRulesCheckRoute({
    readRules: readers.readRules,
    aiCrawlers: options.aiCrawlers,
    servesBoth: options.robots !== false && options.sitemap !== false,
    siteServesOwnRobots: rules =>
      siteServesOwnRobots({ rules, baseUrl: options.baseUrl }),
    listPaths: async (ctx, readRules) => {
      const paths: string[] = [];
      // Each origin's sitemap, as the root sitemap answers on that host.
      for (const origin of await listingOrigins(
        ctx,
        readRules,
        options.baseUrl
      )) {
        const { pages } = await listPages(ctx, {
          origin,
          readRules,
          readStructuredDataRules: readers.readStructuredDataRules,
          codeRoutes,
          ...(sitemapSubset === undefined
            ? {}
            : { collections: sitemapSubset }),
        });
        paths.push(...sitemapPaths(pages));
      }
      return paths;
    },
  });
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
/**
 * How the Proxy answers an address made Gone: with the site's own page,
 * named as an address from the site's root, where the site names one.
 *
 * @throws NextlyError when `page` is not an address from the site's root.
 */
function goneAnswerOf(page: string | undefined): GoneAnswerOptions {
  if (page === undefined) return {};
  const address = codeAddressOf(page);
  if (address === undefined) {
    throw NextlyError.invalidInput({
      message: `seoPlugin: gonePage "${page}" is not an address from the site's root, such as "/gone".`,
      logContext: { gonePage: page },
    });
  }
  return { gonePage: address };
}

export function seoPlugin(options: SeoPluginOptions): PluginDefinition {
  // Always nest the fields (default or custom) under a single `seo` group so
  // every project exposes SEO consistently at `entry.seo.*`.
  const seoFields =
    options.fields ??
    defaultSeoFields({ hardLengthLimits: options.hardLengthLimits === true });
  const pagePermissions = options.pagePermissions === true;
  const goneAnswer = goneAnswerOf(options.gonePage);
  const seoGroup = group({
    name: "seo",
    label: "SEO",
    fields: seoFields,
    // Kept per language wherever the content is translated, so each language
    // has its own title, description and canonical; on a type that is not
    // translated, one value as before.
    localized: true,
    // Where a page's SEO has its own permission, a write of it by anyone
    // without that permission for the page's type keeps the stored SEO, and
    // the rest of the page is saved. Reading it is the page's own read.
    ...(pagePermissions
      ? { access: { create: holdsPageSeo, update: holdsPageSeo } }
      : {}),
  });

  // Which types carry the group: the ones the site names, or every type,
  // read from what the start added it to. Every part below reads it when
  // asked, so a Schema Builder type is answered once it has the group.
  const types = seoTypesOf(options);

  const sitemapSubset = subsetOf(options.sitemap, types);
  const readRules = rulesReader(options, types);
  // The addresses redirects hold, kept for the Proxy and dropped whenever a
  // redirect saved here commits.
  const redirectKeys = heldRedirectKeys();
  // The pages the site's routes render from their own code, read from the
  // build each time they are asked for, so a new deploy is read as it is.
  const codeRoutes = () =>
    readCodeRoutes(
      options.nextBuildDir === undefined
        ? {}
        : { buildDir: options.nextBuildDir }
    );
  // The site's configured origin, where the sitemap is served and a baseUrl
  // is set, for every output that names the site's addresses.
  const siteOrigin = configuredOrigin(
    options,
    sitemapConfig(options, sitemapSubset)
  );
  const googleClient = googleClientOf(options);
  // Stops noting changes for IndexNow when the plugin is taken down.
  let stopIndexNow: (() => Promise<void>) | undefined;
  // The later look at what an earlier version wrote during a deploy.
  let stopRecheck: (() => void) | undefined;

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
    types,
    fields: seoFields,
    baseUrl: options.baseUrl,
    readRules,
    readStructuredDataRules,
    readSocialCardRules,
    pagePermissions,
  });

  // Every page's head, worked out by the one order of who wins, with its
  // links to its other languages, its social card completed, and its
  // structured data, worked out from that same answer and the settings'
  // brand facts, with the plugin's options where the settings say nothing;
  // the home page also carries the verification codes the settings hold.
  // What the site's routes are answered, and what the check of what search
  // engines received compares each page with.
  // A page of a type whose SEO is switched off is answered nothing, so its
  // route serves only what its own code sets. The verification codes are
  // the site's, not the type's, so the home page keeps them either way.
  const pageMetadata = (ctx: PluginContext): PageMetadataResolver =>
    withVerification(
      withSeoOff(
        ctx,
        withStructuredData(
          ctx,
          withSocialCard(
            ctx,
            withLanguageLinks(ctx, seoPageMetadata(ctx, readRules), readRules),
            readSocialCardRules
          ),
          structuredDataFromSettings(readStructuredDataRules)
        ),
        readRules
      ),
      () => readVerificationTags(ctx)
    );

  // What the problem list checks, read with the rules every page's head is
  // worked out by, so the list and the page never disagree.
  const problemChecks = {
    // Read on each check, as the types are.
    get targets() {
      return types.collections;
    },
    get singles() {
      return types.singles;
    },
    // The pages built in code the sitemap lists, and what it lists, for the
    // check of its dates.
    codeRoutes,
    ...sitemapScopeOf(options, sitemapSubset),
    // Whether the plugin serves robots.txt, so its rules can block a page.
    servesRobots: options.robots !== false,
    // Whether a robots.txt of the site's own wins over the plugin's.
    siteServesOwnRobots: (rules: Pick<SiteRules, "productionAddresses">) =>
      siteServesOwnRobots({ rules, baseUrl: options.baseUrl }),
    readers: {
      readRules,
      readStructuredDataRules: structuredDataFromSettings(
        readStructuredDataRules
      ),
      readSocialCardRules,
    },
  };

  // The SEO issues card and its Needs attention line, counting what the
  // problem list finds as each person may read it, so the dashboard and the
  // list never disagree; the line's count is the
  // Problems menu item's badge too. Withheld where no collection carries SEO (see
  // `widget-card`). Where SEO is on every type, which types those are is
  // known only once the site starts, so whoever manages site-wide SEO is
  // shown them instead.
  const issues = seoIssuesSetup(types, problemsForCard(problemChecks));
  const issuesCard = seoIssuesWidget(issues);
  const issuesItem = seoProblemsAttentionItem(issues);

  // The site's sitemap and robots.txt, the action that makes a share image
  // of the right size, the settings and redirects screens' routes, the
  // check of what search engines received, the SEO tab's own and the
  // problem list's; all added below.
  const routes: PluginRoute[] = [];

  const contributes: PluginContributions = {
    // Add the SEO group to each named type, or to every type.
    extend: seoExtendClauses(options, types, [seoGroup]),
    // Site-wide SEO, the check of what search engines received, and, where
    // the site asks for it, each named content type's page SEO.
    permissions: seoPermissionDeclarations({
      types: types.named ? [...types.collections, ...types.singles] : [],
      pagePermissions,
    }),
    // The redirects whose From addresses the address record holds, the log
    // of addresses not found, and what the problem list's checks found.
    collections: [
      // The collection the address record was kept in before it moved to the
      // plugin's own tables. Still declared so the rows a site already has
      // are kept, and moved to the tables at start (`recordReady`); nothing
      // writes it any more.
      addressRecordCollection(),
      redirectsCollection(),
      // The collection the not-found log was kept in before it moved to the
      // plugin's own table. Still declared so the rows a site already has are
      // kept, and moved to the table at start (`moveLoggedRows`); nothing
      // writes it any more.
      notFoundCollection(),
      problemsCollection(),
      // The SEO of each page a route renders from its own code, by address.
      codePagesCollection(),
      // What each entry's or Single's route supplies in code for its head,
      // which the SEO tab, bulk edit and the problem list read.
      routeValuesCollection(),
    ],
    // The plugin's own tables, for bookkeeping written in one statement:
    // the log of addresses not found.
    schema: seoSchema,
    // Every page's head, as worked out above, each page built in code
    // recorded as connected as its route asks for its head, and what each
    // entry's or Single's route supplies in code kept for the admin.
    services: {
      pageMetadata: ctx =>
        withCodePageConnections(
          ctx,
          withRouteValues(ctx, pageMetadata(ctx), types)
        ),
      // Which types' SEO the settings switch off: the admin then draws no
      // SEO tab or group on their pages, and nothing else changes.
      [EXTENSION_SWITCH_SERVICE]: (ctx): ExtensionSwitch => ({
        switchedOff: async field =>
          field === SEO_GROUP
            ? seoOffTypes(await readRules(ctx, undefined), types, message =>
                ctx.logger.warn(message)
              )
            : [],
      }),
      // The pages the site lists and the problems that left any out, read by
      // the same rules as the head: one reading for every listing output.
      listedPages: (ctx): ListedPagesService => ({
        list: (origin: string) =>
          listPages(ctx, {
            origin,
            readRules,
            readStructuredDataRules:
              problemChecks.readers.readStructuredDataRules,
            codeRoutes,
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
    // A page's plain-text copy and the IndexNow key, once switched on, are
    // answered here too, each at its own address only.
    proxy: [
      stagingGuard(readRules),
      redirectsProxyHandler(redirectKeys, undefined, goneAnswer),
      plainCopyProxyHandler({
        readRules,
        ...siteOrigin,
        ...(sitemapSubset === undefined ? {} : { collections: sitemapSubset }),
      }),
      indexNowKeyProxyHandler({ readRules, ...siteOrigin }),
    ],
    // The optional connections' own state, their credentials sealed: core
    // encrypts each secret path and never returns it to the admin.
    settings: connectionSettings,
    // Changed only by whoever manages site-wide SEO, through core's own
    // settings route as through the plugin's.
    settingsPermission: MANAGE_SEO_PERMISSION,
    // The events the address record announces once a save commits: each
    // page's addresses, which IndexNow takes its notes from; that redirects
    // changed, which the Proxy's kept addresses are dropped on; and that who
    // holds an address changed, which expires the page heads built from it.
    events: [
      { name: ADDRESSES_MOVED },
      { name: REDIRECTS_CHANGED },
      { name: ADDRESS_RECORD_CHANGED },
    ],
    // The site-wide SEO settings: name, defaults, patterns and brand facts.
    singles: [seoSettingsSingle()],
    // The SEO settings screen, for whoever may read the settings, told what
    // the plugin's options answer until the site chooses: what robots.txt
    // asks AI tools and which types are hidden, which the site's own
    // robots.txt and pages already say.
    admin: {
      ...tab.admin,
      // The SEO tab on every edit page the group is added to, and the one in
      // the Page Builder's Settings, where it runs.
      contributions: [...(tab.admin?.contributions ?? []), PAGE_BUILDER_TAB],
      clientConfig: {
        aiCrawlers: options.aiCrawlers ?? "all",
        hiddenTypes: [...new Set(options.hiddenTypes ?? [])],
        // Each type's structured data choice the options make, which the
        // screen shows until the site chooses its own.
        structuredData: checkedTypeRules(options.structuredData?.types),
        // The collections whose pages the SEO tab edits, so the tab in the
        // Page Builder's Settings knows a page it has a group to edit.
        tabCollections: tab.tabCollections,
        // Where SEO is on every type, the tab there edits each page whose
        // type has the group, which only the page's own fields say.
        tabEveryType: tab.tabEveryType,
      },
      // The section's menu, in the order the section is used: where it
      // stands, its pages, what to fix, its redirects, its rules. Each
      // screen's other addresses (`overview/contract`) are reached from these.
      menu: [
        {
          label: "Overview",
          to: OVERVIEW_PAGE_HREF,
          icon: "LayoutDashboard",
          requiredPermission: MANAGE_SEO_PERMISSION,
        },
        // The site-wide screens are gated on the plugin's own permissions,
        // whose names no host renames. The settings also need the Single's
        // own read, which an entry can't ask beside this one: someone
        // holding `manage-seo` without it opens the screen and is refused
        // its contents by the routes.
        {
          label: "Pages",
          to: PAGES_PAGE_HREF,
          icon: "FileText",
          requiredPermission: MANAGE_SEO_PERMISSION,
        },
        // Shown to everyone in the admin: the list answers each person with
        // the pages of the types they may read, and says so where none. Its
        // badge is the errors and warnings they would find there.
        {
          label: "Problems",
          to: PROBLEMS_PAGE_HREF,
          icon: "AlertTriangle",
          ...(issuesItem === undefined
            ? {}
            : { badge: { attention: SEO_PROBLEMS_ATTENTION_ID } }),
        },
        {
          label: "Redirects",
          to: REDIRECTS_PAGE_HREF,
          icon: "Route",
          requiredPermission: MANAGE_SEO_PERMISSION,
        },
        {
          label: "Settings",
          to: SETTINGS_PAGE_HREF,
          icon: "Settings",
          requiredPermission: MANAGE_SEO_PERMISSION,
        },
      ],
      pages: [
        // No startup reads: the startup request answers only when every part
        // has, and the checklist can read every page while an earlier SEO
        // field group waits to be imported, which would hold up the whole
        // admin's first answer on a large site.
        { ...OVERVIEW_PAGE, requiredPermission: MANAGE_SEO_PERMISSION },
        { ...PAGES_PAGE, requiredPermission: MANAGE_SEO_PERMISSION },
        { ...IMPORT_PAGE, requiredPermission: MANAGE_SEO_PERMISSION },
        { ...INSPECT_PAGE, requiredPermission: CHECK_SEO_PERMISSION },
        PROBLEMS_PAGE,
        { ...REDIRECTS_PAGE, requiredPermission: MANAGE_SEO_PERMISSION },
        { ...SETTINGS_PAGE, requiredPermission: MANAGE_SEO_PERMISSION },
        // Old addresses, each sending a bookmark on to the screen that
        // replaced it: bulk edit to Pages in Edit mode, and the check of
        // what search engines received to Inspect, or to Pages.
        BULK_PAGE,
        RECEIVED_PAGE,
      ],
    },
  };

  if (issuesCard || issuesItem) {
    contributes.dashboard = {
      ...(issuesCard ? { widgets: [issuesCard] } : {}),
      ...(issuesItem ? { attention: [issuesItem] } : {}),
    };
  }

  // What an import reads and writes with, from the Import screen and the
  // Overview's checklist alike.
  const importSetup = {
    get targets() {
      return types.keys;
    },
    readRules,
    checks: problemChecks,
    pagePermissions,
  };

  routes.push(
    // The Connections tab's reads, and Search Console's sign-in.
    ...searchConsoleRoutes({ readRules, client: googleClient, ...siteOrigin }),
    ...siteFileRoutes(
      options,
      {
        readRules,
        readStructuredDataRules: problemChecks.readers.readStructuredDataRules,
      },
      sitemapSubset,
      codeRoutes
    ),
    shareImageRoute(options.baseUrl),
    // What the settings screen reads: the types SEO is added to, and which
    // Single holds the settings.
    contentTypesRoute(types),
    // Which sitemap pages the own robots.txt rules being typed would block.
    ownRulesCheckRoute(options, {
      readRules,
      readStructuredDataRules: problemChecks.readers.readStructuredDataRules,
      codeRoutes,
      sitemapSubset,
    }),
    settingsDocumentRoute(),
    // What the redirects screen reads and writes.
    ...redirectRoutes(),
    // What Inspect checks.
    ...receivedRoutes({
      get collections() {
        return types.collections;
      },
      get singles() {
        return types.singles;
      },
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      readRules,
      pageMetadata,
      structuredDataReaders: problemChecks.readers,
      aiCrawlers: options.aiCrawlers,
    }),
    // Whether the live home page carries the saved verification codes.
    verificationCheckRoute({
      baseUrl: options.baseUrl,
      readRules,
      readTags: readVerificationTags,
    }),
    ...tab.routes,
    // What a Page Builder template's SEO panel reads.
    seoTemplateRoute({ readRules, baseUrl: options.baseUrl }),
    ...problemRoutes(problemChecks),
    // Pages' list, and its save of a page with no
    // entry's SEO.
    ...codePageRoutes({
      readRules,
      routes: codeRoutes,
      origin: () =>
        options.baseUrl === undefined
          ? undefined
          : resolveBaseOrigin(options.baseUrl),
    }),
    // The bulk edit table, and the import beside it, over every type SEO is
    // added to: each collection, and each Single as `single:<slug>`.
    ...bulkRoutes({
      get targets() {
        return types.keys;
      },
      readRules,
      checks: problemChecks,
      pagePermissions,
    }),
    ...importRoutes(importSetup),
    // The Overview's setup checklist, read from what the plugin stores.
    ...checklistRoutes({
      get types() {
        return types.keys;
      },
      readRules,
      readBrand: ctx => readBrandFacts(ctx),
      readSetupWaiting: setupWaiting,
      importSetup,
    })
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
    // The schema version its migrations bring the database to, read from the
    // one declaration of its tables.
    schemaVersion: seoSchemaPlugin.schemaVersion,
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
      // The section opens on its Overview; someone who may not open it
      // lands on the first menu item they may.
      landing: OVERVIEW_PAGE_HREF,
      appearance: { icon: "Search", label: "SEO" },
      description:
        "Add an SEO meta field group to your collections, with title, description and social preview fields",
    },
    category: "seo",
    tags: ["seo", "meta"],
    // The route helpers ask this plugin for each page's head.
    provides: ["page-metadata"],
    // Where the Page Builder runs, its Settings dialog has an SEO tab; where
    // it does not, the tab is left out and the site starts as before.
    optionalDependsOn: { [PAGE_BUILDER_PLUGIN]: `>=${PLUGIN_VERSION}` },
    contributes,
    capabilities: {
      // IndexNow's shared endpoint and Google's Search Console addresses,
      // and nothing else.
      net: { outbound: [INDEXNOW_HOST, ...SEARCH_CONSOLE_HOSTS] },
      secrets: CONNECTION_SECRETS,
    },
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
      prepareRecordMove(ctx);
      ctx.publicAddresses.participate(addressRecord(ctx));
      releaseOnCollectionDelete(ctx);
      // A page head reads who holds its address, so a change to that
      // expires the heads, once it commits.
      ctx.events.on(ADDRESS_RECORD_CHANGED, () =>
        ctx.cache.expire(ADDRESS_RECORD_CACHE_PART)
      );
      // A redirect saved here applies from this server's next request.
      ctx.events.on(REDIRECTS_CHANGED, () => redirectKeys.forget());
      // Kept for the routes that answer not found, which log through it, and
      // for the pages built in code, which read their SEO through it.
      keepSeoContext(ctx);
      // Each saved page checked again for the problem list.
      watchSaves(ctx, problemChecks);
      // Each saved page's sitemap date moved only where its content changed.
      watchContentDates(ctx, types);
      keepCodeRoutes(codeRoutes);
      // Changed pages noted for IndexNow, told once they settle.
      stopIndexNow = watchForIndexNow(ctx, { readRules, ...siteOrigin }, types);
    },
    // Between an uninstall that keeps the data and the next install, the
    // plugin does not run: pages saved meanwhile reach no record. Both
    // forget the catch-up's fingerprint, so the first start after the
    // install records them. A full uninstall drops the record instead.
    async onInstall(ctx) {
      await forgetCatchUpFingerprint(ctx);
    },
    async onUninstall(ctx, { keepData }) {
      if (keepData) await forgetCatchUpFingerprint(ctx);
    },
    async destroy() {
      stopRecheck?.();
      stopRecheck = undefined;
      // What was noted is still sent: a notice is not lost to a shutdown.
      const stop = stopIndexNow;
      stopIndexNow = undefined;
      await stop?.();
    },
    async onReady(ctx) {
      // Awaited, so the start waits for it: the address record an earlier
      // version kept in a collection moves to the plugin's table before this
      // process answers any save, or a page could take an address the
      // collection says another holds. One read once it has moved.
      await recordReady(ctx);
      // Started, not awaited: it waits for the boot to finish, and brings the
      // record up to date with content saved while the plugin was absent or
      // addresses a deploy moved.
      void startCatchUp(ctx);
      // The not-found log an earlier version kept in a collection, moved to
      // the plugin's table; one count once there is nothing left to move.
      void moveLoggedRows(ctx).catch((error: unknown) => {
        ctx.logger.error(
          "The SEO plugin could not move its not-found log to its table",
          { error }
        );
      });
      // Both again once, a while later, unawaited and never keeping the
      // process alive: a process of the earlier version still serving
      // during a deploy may write after this start, and a long-running
      // server may not start again until the next one.
      stopRecheck?.();
      stopRecheck = startRecheck(
        async () => {
          await lastCatchUp();
          await startCatchUp(ctx);
          await moveLoggedRows(ctx);
        },
        (error: unknown) => {
          ctx.logger.error(
            "The SEO plugin could not take in what an earlier version wrote during a deploy",
            { error }
          );
        }
      );
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
