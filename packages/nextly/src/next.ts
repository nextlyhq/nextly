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

import { createRequire } from "node:module";
import { resolve } from "node:path";

import { warnIfCacheComponentsOff } from "./cache-components";
import {
  BUILD_SCHEMA_VERSION_ENV,
  newestMigrationIn,
  type RunnersFolderReading,
} from "./domains/schema/build-schema-version";
import { nextlyTracingIncludes } from "./next-runtime-includes";
import { statedDialect } from "./shared/lib/stated-dialect";
import { DEFAULT_MIGRATIONS_DIR } from "./shared/types/migrations-dir-default";

// The files `withNextly` adds to every route's trace, for a config that is not
// wrapped in it to add itself.
export { nextlyTracingIncludes } from "./next-runtime-includes";

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
  // Meta's and Amazon's AI search crawlers and the fetchers each sends for a
  // person's request: they read the HTML they are sent, and none is known
  // to run a page's script.
  "meta-webindexer",
  "meta-externalfetcher",
  "Amzn-SearchBot",
  "Amzn-User",
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
const ROOT_FILES = [
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  // The whole site in one file, which tools reading llms.txt may ask for too.
  "/llms-full.txt",
] as const;

/**
 * The IndexNow key file: a key of 32 lower-case hex characters, served at the
 * site's root, where the protocol requires it to prove the whole host. Like
 * the files above, the site's own (a `public/` file, a route, a rewrite of
 * its own) comes first, and a plugin route mounted at
 * {@link KEY_FILE_ROUTE_PREFIX} answers it otherwise, with no Proxy needed.
 */
const KEY_FILE_SOURCE = "/:key([0-9a-f]{32}).txt";

/**
 * Where the key file is answered behind the API handler: `<prefix>/<key>`. A
 * plugin's root route at `/indexnow-key/:key` answers it.
 */
export const KEY_FILE_ROUTE_PREFIX = "/indexnow-key";

/**
 * Where a feed file is answered behind the API handler: `<prefix><address>`,
 * so `/blog/feed.xml` reaches `<api>/feed-files/blog/feed.xml`. A plugin's
 * root route at that path answers it. A prefix of its own, as the key file's
 * is, so a feed under a name the built-in router claims (`/users/feed.xml`)
 * still reaches the plugin.
 */
export const FEED_FILE_ROUTE_PREFIX = "/feed-files";

/**
 * The feed addresses a plugin may answer: `feed.xml` at the site's root, or
 * in one folder of it (`/blog/feed.xml`), the names feed readers and sites
 * use for a site's feed and a section's. On the same terms as the files
 * above: the site's own page, route file, `public/` file or rewrite of such
 * an address comes first.
 */
const ROOT_FEED_SOURCE = "/feed.xml";
const SECTION_FEED_SOURCE = "/:section/feed.xml";

/**
 * Where a folder's llms files are answered behind the API handler:
 * `<prefix><address>`, so `/docs/llms.txt` reaches
 * `<api>/llms-files/docs/llms.txt`. A plugin's root route at that path
 * answers it, on the same terms as a folder's feed.
 */
export const LLMS_FILE_ROUTE_PREFIX = "/llms-files";

/**
 * The llms files a folder of the site may have of its own, as the llms.txt
 * proposal allows a file to cover the addresses under its path.
 */
const FOLDER_LLMS_FILES = ["llms.txt", "llms-full.txt"] as const;

/**
 * A folder name no site's rule names, to ask whether a rule reaches every
 * folder's file rather than one folder's.
 */
const ANY_FOLDER_SAMPLE = "nextly-any-folder-7f3a";

/**
 * A folder name a folder file's rewrite can leave to the site by name: the
 * characters an address's segment holds unescaped, none of which a route
 * pattern reads as anything but itself once `.` is escaped.
 */
const PLAIN_FOLDER = /^[A-Za-z0-9._~-]+$/;

/**
 * The source of the rewrite of `/<folder>/<file>` to a plugin, given the
 * sources of the site's own rewrites; none where the site rewrites every
 * folder's `file` itself. Next asks our `afterFiles` before the site's
 * `fallback`, so a folder the site rewrites, such as `/blog/feed.xml` or
 * `/blog/:path*`, is left out of the pattern by name and keeps reaching the
 * site's rule. A site rule under a folder pattern this cannot read name by
 * name (`/:lang(en|fr)/feed.xml`, `/:lang(en|fr)/:path*`) that reaches a
 * folder's `file` keeps every folder's.
 */
function sectionFileSource(
  theirs: readonly string[],
  matches: (source: string, path: string) => boolean,
  file: string
): string | null {
  const claimed = new Set<string>();
  for (const source of theirs) {
    // Asked of a folder no site names, so a rule for one folder (even one
    // called `section`) is left out by name below rather than read as a
    // rule for every folder.
    if (matches(source, `/${ANY_FOLDER_SAMPLE}/${file}`)) return null;
    const folder = /^\/([^/]+)\//.exec(source)?.[1];
    if (folder === undefined) continue;
    if (!PLAIN_FOLDER.test(folder)) {
      // A folder pattern (`/:lang(en|fr)/:path*`) can't be left out by name:
      // read as one plain folder, a rule whose rest reaches the file keeps
      // every folder's for the site.
      const rest = source.slice(folder.length + 1);
      if (matches(`/x${rest}`, `/x/${file}`)) return null;
      continue;
    }
    if (matches(source, `/${folder}/${file}`)) claimed.add(folder);
  }
  if (claimed.size === 0) return `/:section/${file}`;
  // A lookahead at the folder's start, which Next's matcher accepts inside a
  // non-capturing group: any folder but the ones the site rewrites.
  const names = [...claimed].map(folder => folder.replace(/\./g, "\\."));
  return `/:section((?:(?!(?:${names.join("|")})/)[^/]+))/${file}`;
}

/** A key file's address, to ask whether the site rewrites such addresses itself. */
const KEY_FILE_SAMPLE = `/${"0".repeat(32)}.txt`;

/** Options for {@link withNextly}. */
export interface WithNextlyOptions {
  /**
   * Where the app mounts Nextly's API handler. Defaults to `/admin/api`, the
   * scaffolded `app/admin/api/[[...params]]` route.
   */
  apiRoute?: string;
  /** More root files, beyond robots.txt, sitemap.xml, llms.txt and llms-full.txt, that a plugin answers. */
  rootFiles?: readonly string[];
  /**
   * Whether `/feed.xml` and `/<folder>/feed.xml` reach a plugin that answers
   * feeds, where the site serves no file of its own there. On by default.
   * Turn it off where the site's own dynamic route answers such an address
   * (`app/[section]/feed.xml/route.ts`): a rewrite is asked before a dynamic
   * route, so the plugin would answer it instead.
   */
  feedFiles?: boolean;
  /**
   * Whether `/<folder>/llms.txt` and `/<folder>/llms-full.txt` reach a
   * plugin that answers a folder's own llms files, where the site serves no
   * file of its own there. On by default. Turn it off where the site's own
   * dynamic route answers such an address (`app/[section]/llms.txt/route.ts`):
   * a rewrite is asked before a dynamic route, so the plugin would answer it
   * instead.
   */
  folderLlmsFiles?: boolean;
  /**
   * The app's migrations folder, relative to the project root, as
   * `db.migrationsDir` in the Nextly config sets it. Defaults to
   * `./src/db/migrations`, that setting's default. Its newest migration is
   * the build's schema version, which a production start compares with the
   * database's.
   */
  migrationsDir?: string;
  /**
   * The database dialect the app's migrations run on, which decides which of
   * a migration's dialect variants runs and how an earlier Schema Builder's
   * files are recognised. Defaults to the one the environment states
   * (`DB_DIALECT`, else the one `DATABASE_URL` implies, else PostgreSQL), as
   * Nextly reads it at run time.
   */
  dialect?: "postgresql" | "mysql" | "sqlite";
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

/** The rewrites of the feed files to the handler's feed routes, around the site's own rules. */
function feedRewrites(
  theirs: readonly string[],
  matches: (source: string, path: string) => boolean,
  apiRoute: string
): Rewrite[] {
  const rewrites: Rewrite[] = [];
  if (!theirs.some(source => matches(source, ROOT_FEED_SOURCE))) {
    rewrites.push({
      source: ROOT_FEED_SOURCE,
      destination: `${apiRoute}${FEED_FILE_ROUTE_PREFIX}${ROOT_FEED_SOURCE}`,
    });
  }
  const section = sectionFileSource(theirs, matches, "feed.xml");
  if (section !== null) {
    rewrites.push({
      source: section,
      destination: `${apiRoute}${FEED_FILE_ROUTE_PREFIX}${SECTION_FEED_SOURCE}`,
    });
  }
  return rewrites;
}

/**
 * The rewrites of a folder's llms files to the handler's routes for them,
 * around the site's own rules: each folder's left to a site that rewrites
 * that folder's file itself.
 */
function folderLlmsRewrites(
  theirs: readonly string[],
  matches: (source: string, path: string) => boolean,
  apiRoute: string
): Rewrite[] {
  return FOLDER_LLMS_FILES.flatMap(file => {
    const source = sectionFileSource(theirs, matches, file);
    return source === null
      ? []
      : [
          {
            source,
            destination: `${apiRoute}${LLMS_FILE_ROUTE_PREFIX}/:section/${file}`,
          },
        ];
  });
}

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
      : (theirs ?? {});
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
    // The key file, on the same terms: left to a site that rewrites such an
    // address itself.
    const keyFileRewrites = all.some(
      rule =>
        typeof rule.source === "string" && matches(rule.source, KEY_FILE_SAMPLE)
    )
      ? []
      : [
          {
            source: KEY_FILE_SOURCE,
            destination: `${apiRoute}${KEY_FILE_ROUTE_PREFIX}/:key`,
          },
        ];
    // The feed files, on the same terms: the root's left to a site that
    // rewrites it itself, each folder's to a site that rewrites that folder's,
    // and all of them where the site turns them off.
    // The sources of the site's own rules, which the folder files' rewrites
    // are shaped around.
    const theirSources = all.flatMap(rule =>
      typeof rule.source === "string" ? [rule.source] : []
    );
    const feedFileRewrites =
      options.feedFiles === false
        ? []
        : feedRewrites(theirSources, matches, apiRoute);
    // A folder's own llms files, on the same terms as a folder's feed.
    const llmsFileRewrites =
      options.folderLlmsFiles === false
        ? []
        : folderLlmsRewrites(theirSources, matches, apiRoute);
    return {
      beforeFiles: phases.beforeFiles ?? [],
      afterFiles: [
        ...(phases.afterFiles ?? []),
        ...rootRewrites,
        ...keyFileRewrites,
        ...feedFileRewrites,
        ...llmsFileRewrites,
      ],
      fallback: phases.fallback ?? [],
    };
  };
}

/**
 * The runner's reading of the migrations folder (`readMigrationFolderSync`),
 * loaded when it is first needed: it brings the core schema with it, which
 * would add most of a second to every load of `next.config`, and a folder
 * needs it only when it holds a file an earlier Schema Builder wrote.
 *
 * Required synchronously, since `withNextly` returns the config at once: the
 * built `cli/utils` entry, which sits beside this one in `dist`.
 */
function loadRunnersReading(): RunnersFolderReading {
  const loaded = createRequire(import.meta.url)("./cli/utils/index.mjs") as {
    readMigrationFolderSync: RunnersFolderReading;
  };
  return loaded.readMigrationFolderSync;
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

  // Force-include database packages in Vercel Lambda output, and the
  // Next.js files Nextly loads at request time through requires no trace
  // follows (`nextlyTracingIncludes`). pnpm's strict .pnpm store uses
  // symlinks for peer deps, but Vercel's Lambda filesystem doesn't follow
  // symlink chains.
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
    { "/**": nextlyTracingIncludes() }
  );

  // The build's schema version: the newest migration in the app's folder,
  // named while Next.js loads this config, from the project root it loads it
  // in. Handed to the server two ways, since Nextly itself is a server
  // external that Next.js does not inline values into: through `env`, which
  // Next.js inlines into the app's `instrumentation.ts` for it to pass to
  // `createRegister` on every host, and on `process.env`, which Next.js keeps
  // for the server `next start` starts after loading the config, for a hook
  // that passes none. No migration, no version, and a production start then
  // compares nothing.
  // Read as the runner reads it on the app's dialect, so a file the runner
  // sets aside is never named; its reading is loaded only for a folder that
  // could hold one (`loadRunnersReading`).
  const buildVersion = newestMigrationIn(
    resolve(process.cwd(), options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR),
    options.dialect ?? statedDialect(process.env),
    loadRunnersReading
  );
  if (buildVersion !== undefined) {
    process.env[BUILD_SCHEMA_VERSION_ENV] = buildVersion;
  }
  const env = nextConfig.env as Record<string, string> | undefined;

  return {
    ...nextConfig,
    ...(buildVersion === undefined
      ? {}
      : { env: { ...env, [BUILD_SCHEMA_VERSION_ENV]: buildVersion } }),
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
