/**
 * Next.js Config Wrapper
 *
 * Provides `withNextly()` to automatically configure Next.js for
 * compatibility with Nextly's server-side packages. This prevents
 * bundler errors (e.g., "Cannot find package 'pg'") on Vercel and
 * other serverless platforms.
 *
 * @module nextly/next
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // next.config.ts
 * import { withNextly } from "nextly/next";
 *
 * export default withNextly({
 *   // your Next.js config
 * });
 * ```
 */

import { warnIfCacheComponentsOff } from "./cache-components";

/**
 * Packages that must be loaded from node_modules at runtime
 * instead of being bundled by Next.js.
 *
 * These are server-only packages that use native Node.js features
 * (TCP sockets, native bindings, etc.) incompatible with bundling.
 */
const NEXTLY_SERVER_EXTERNAL_PACKAGES = [
  // Nextly core and adapters
  "nextly",
  "@nextlyhq/adapter-drizzle",
  "@nextlyhq/adapter-postgres",
  "@nextlyhq/adapter-mysql",
  "@nextlyhq/adapter-sqlite",
  // Database drivers
  "pg",
  "mysql2",
  "better-sqlite3",
  // ORM
  "drizzle-orm",
  // Kit — loaded lazily via createRequire (bundler-opaque), so this entry is
  // defense-in-depth rather than load-bearing; the bare package covers the
  // per-dialect payload/* subpaths in Next's externals matching.
  "drizzle-kit",
  // Auth (jose is a pure ESM package, no native bindings)
  "jose",
];

/**
 * Packages that must be explicitly included in the Vercel Lambda
 * output via `outputFileTracingIncludes`.
 *
 * pnpm's strict `.pnpm` store uses symlinks for peer deps, but
 * Vercel's Lambda filesystem doesn't always follow symlink chains.
 * This forces Next.js/NFT to copy these packages into the Lambda
 * regardless of whether tracing resolves them.
 */
const NEXTLY_FILE_TRACING_INCLUDES = [
  "./node_modules/pg/**/*",
  "./node_modules/pg-*/**/*",
  "./node_modules/mysql2/**/*",
  "./node_modules/better-sqlite3/**/*",
  "./node_modules/@nextlyhq/adapter-postgres/**/*",
  "./node_modules/@nextlyhq/adapter-mysql/**/*",
  "./node_modules/@nextlyhq/adapter-sqlite/**/*",
  "./node_modules/@nextlyhq/adapter-drizzle/**/*",
  "./node_modules/drizzle-orm/**/*",
];

/**
 * The crawlers Next.js's own default already waits for: those that read a
 * page's head from the first HTML and run no script, so streamed metadata
 * would reach them too late. Kept as its source, from Next.js's
 * `HTML_LIMITED_BOT_UA_RE`, because setting `htmlLimitedBots` replaces that
 * default rather than adding to it; a test holds this copy to the installed
 * Next.js, so a crawler Next.js adds is not silently dropped.
 */
const NEXT_DEFAULT_HTML_LIMITED_BOTS =
  "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight";

/**
 * The crawlers a Nextly site also waits for, besides Next.js's own list: the
 * main Googlebot, which Next.js leaves out because it runs scripts, but whose
 * first reading of a page is the HTML it was sent; and the AI crawlers and
 * answer engines, which run none.
 */
const NEXTLY_ADDED_HTML_LIMITED_BOTS = [
  "Googlebot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "CCBot",
  "Amazonbot",
  "Bytespider",
  "meta-externalagent",
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
];

/**
 * `htmlLimitedBots` for a Nextly site's `next.config`: Next.js's own list and
 * the crawlers above. A request from one of them is answered with the page's
 * whole head in the first HTML, rather than streamed in after it, so what a
 * search engine or an AI crawler reads of a page is what the page's metadata
 * says. `withNextly` sets it; a config not wrapped in it sets it directly:
 *
 * ```ts
 * import { nextlyHtmlLimitedBots } from "nextly/next";
 * const nextConfig = { htmlLimitedBots: nextlyHtmlLimitedBots };
 * ```
 */
export const nextlyHtmlLimitedBots: RegExp = new RegExp(
  [NEXT_DEFAULT_HTML_LIMITED_BOTS, ...NEXTLY_ADDED_HTML_LIMITED_BOTS].join("|"),
  "i"
);

/**
 * Wraps a Next.js config to add Nextly-required settings.
 *
 * Warns once when the config has Cache Components or Partial Prefetching
 * off: Nextly supports only both on.
 *
 * Sets `htmlLimitedBots` to {@link nextlyHtmlLimitedBots} unless the config
 * sets its own, so search engines and AI crawlers read each page's whole head
 * in the first HTML.
 *
 * Automatically adds server-external packages so database drivers
 * and adapters are loaded from node_modules at runtime instead of
 * being bundled (which fails on serverless platforms like Vercel).
 *
 * @param nextConfig - Your Next.js configuration
 * @returns Enhanced Next.js configuration with Nextly compatibility
 *
 * @example
 * ```typescript
 * // next.config.ts
 * import { withNextly } from "nextly/next";
 *
 * export default withNextly({
 *   images: {
 *     remotePatterns: [{ hostname: "example.com" }],
 *   },
 * });
 * ```
 *
 * @example With other plugins
 * ```typescript
 * import { withNextly } from "nextly/next";
 *
 * const nextConfig = {
 *   reactCompiler: true,
 * };
 *
 * export default withNextly(nextConfig);
 * ```
 */
/**
 * The files a site serves at its root that plugins may answer for: the
 * crawler files every site has a place for. A plugin route mounted at the
 * root (`mount: "root"`) answers one of them behind the API handler.
 */
const ROOT_FILES = ["/robots.txt", "/sitemap.xml", "/llms.txt"] as const;

/** Options for {@link withNextly}. */
export interface WithNextlyOptions {
  /**
   * Where the app mounts Nextly's API handler. Defaults to `/admin/api`, the
   * scaffolded `app/admin/api/[[...params]]` route.
   */
  apiRoute?: string;
  /** More root files, beyond robots.txt, sitemap.xml and llms.txt, that a plugin answers. */
  rootFiles?: readonly string[];
}

type Rewrite = Record<string, unknown>;
interface RewritePhases {
  beforeFiles: Rewrite[];
  afterFiles: Rewrite[];
  fallback: Rewrite[];
}

/** Whether a rewrite source of the site's can match `path`. */
type SourceMatcher = (source: string, path: string) => boolean;

/**
 * Next's own matcher for rewrite sources, so a pattern counts as matching
 * exactly when Next would apply it. Should a Next release move it, a source
 * with a parameter in its first segment (`/:path*`) is taken to match: the
 * site's rewrite is kept, as when it matches.
 */
async function sourceMatcher(): Promise<SourceMatcher> {
  try {
    const mod = (await import(
      "next/dist/shared/lib/router/utils/path-match.js"
    )) as {
      getPathMatch?: GetPathMatch;
      default?: { getPathMatch?: GetPathMatch };
    };
    const getPathMatch = mod.getPathMatch ?? mod.default?.getPathMatch;
    if (getPathMatch) {
      return (source, path) => getPathMatch(source)(path) !== false;
    }
  } catch {
    // Fall through to the cautious reading below.
  }
  return (source, path) => source === path || /^\/[:(*]/.test(source);
}
type GetPathMatch = (
  source: string
) => (path: string) => Record<string, unknown> | false;

/**
 * The site's own rewrites, with each root file rewritten to the API handler
 * after them. `afterFiles` is checked once the site's own pages, route files
 * (`app/robots.ts`) and `public/` files have been, and before its dynamic
 * pages (`app/[[...slug]]`), so a plugin answers only where the site does not.
 * A root file the site rewrites itself, in any phase, is left to the site:
 * Next asks `afterFiles` before `fallback`, so an entry of ours would win over
 * the site's own fallback. Rewritten to the handler, never past it, so no core
 * route is exposed at the root.
 */
function withRootFileRewrites(
  config: Record<string, unknown>,
  options: WithNextlyOptions
): () => Promise<RewritePhases> {
  const own = config.rewrites as (() => unknown) | undefined;
  const apiRoute = (options.apiRoute ?? "/admin/api").replace(/\/+$/, "");
  const files = [...new Set([...ROOT_FILES, ...(options.rootFiles ?? [])])];
  return async () => {
    // As Next calls it: a method of the config, which may read `this`.
    const theirs: unknown = own ? await own.call(config) : undefined;
    const phases: Partial<RewritePhases> = Array.isArray(theirs)
      ? // A plain list is Next's `afterFiles`.
        { afterFiles: theirs as Rewrite[] }
      : ((theirs ?? {}) as Partial<RewritePhases>);
    const all = [
      ...(phases.beforeFiles ?? []),
      ...(phases.afterFiles ?? []),
      ...(phases.fallback ?? []),
    ];
    const matches = await sourceMatcher();
    const rootRewrites = files
      .filter(
        file =>
          !all.some(
            rule =>
              typeof rule.source === "string" && matches(rule.source, file)
          )
      )
      .map(file => ({ source: file, destination: `${apiRoute}${file}` }));
    return {
      beforeFiles: phases.beforeFiles ?? [],
      afterFiles: [...(phases.afterFiles ?? []), ...rootRewrites],
      fallback: phases.fallback ?? [],
    };
  };
}

export function withNextly<T extends Record<string, unknown>>(
  nextConfig: T,
  options: WithNextlyOptions = {}
): T {
  // Read while Next.js loads the config, before anything builds or serves.
  // Only here does Nextly see `partialPrefetching`: Next.js passes it to no
  // code at run time.
  warnIfCacheComponentsOff(
    {
      cacheComponents: nextConfig.cacheComponents,
      partialPrefetching: nextConfig.partialPrefetching,
    },
    "this next.config"
  );

  const existing =
    (nextConfig.serverExternalPackages as string[] | undefined) ?? [];

  // Merge without duplicates
  const merged = [
    ...new Set([...existing, ...NEXTLY_SERVER_EXTERNAL_PACKAGES]),
  ];

  // Force-include database packages in Vercel Lambda output.
  // pnpm's strict .pnpm store uses symlinks for peer deps, but
  // Vercel's Lambda filesystem doesn't follow symlink chains.
  //
  // Next.js reads `outputFileTracingIncludes` at the top level only. Under
  // `experimental` it warns on every build that the key is unrecognized and
  // has moved, then copies it to the top level by assignment, replacing the
  // app's own. So the app's entries, from either place, are merged with
  // Nextly's at the top level, and none is left under `experimental`.
  const { outputFileTracingIncludes: experimentalIncludes, ...experimental } =
    (nextConfig.experimental as Record<string, unknown> | undefined) ?? {};
  const includes = mergeIncludes(
    mergeIncludes(
      nextConfig.outputFileTracingIncludes as TracingIncludes | undefined,
      experimentalIncludes as TracingIncludes | undefined
    ),
    { "/**": NEXTLY_FILE_TRACING_INCLUDES }
  );

  return {
    ...nextConfig,
    serverExternalPackages: merged,
    ...(nextConfig.experimental === undefined ? {} : { experimental }),
    outputFileTracingIncludes: includes,
    // The app's own list stands where it set one; otherwise Nextly's, so the
    // crawlers it names read each page's whole head in the first HTML.
    htmlLimitedBots: nextConfig.htmlLimitedBots ?? nextlyHtmlLimitedBots,
    rewrites: withRootFileRewrites(nextConfig, options),
  };
}

/** Next.js's `outputFileTracingIncludes`: route pattern to file globs. */
type TracingIncludes = Record<string, string[]>;

/** Both sets of globs for each route pattern, `first`'s before `second`'s, each glob once. */
function mergeIncludes(
  first: TracingIncludes | undefined,
  second: TracingIncludes | undefined
): TracingIncludes {
  const merged: TracingIncludes = { ...first };
  for (const [pattern, globs] of Object.entries(second ?? {})) {
    merged[pattern] = [...new Set([...(merged[pattern] ?? []), ...globs])];
  }
  return merged;
}
