/**
 * The Next.js files Nextly loads at request time that no build trace names.
 *
 * Nextly is a server external, so its `dist` is plain Node code that the build
 * traces file by file. It reaches Next.js through `createRequire` with a
 * specifier held in a variable (`next/navigation` for not-found and
 * redirects, `next/cache` for cached reads and revalidation, `next/headers`
 * and `next/server` for request headers, `after()` and `connection()`), which
 * keeps Next.js out of a consumer that is not a Next.js app. A tracer cannot
 * follow a variable, so nothing makes the build ship what those requires
 * load. Next's require hook adds more on the server: `next/navigation`'s
 * `*.shared-runtime` contexts are redirected to the pages router's vendored
 * contexts, which load the pages router's compiled runtime, `react-dom`'s edge
 * server and `styled-jsx`. A literal specifier would not help there: no
 * tracer sees where the hook sends a require.
 *
 * A host that deploys each function with only its traced files (Vercel)
 * then fails the first request that takes one of these paths with "Cannot
 * find module", while `next start` over a whole `node_modules` never shows
 * it. So `withNextly` adds them to every route's `outputFileTracingIncludes`,
 * and {@link nextlyTracingIncludes} hands the same list to a config that is
 * not wrapped in it.
 *
 * The patterns come from the require graph of a production server answering
 * through those four entries. Directories are named where a file's
 * neighbours are as likely to be loaded by the next Next.js release, single
 * files where the directory is large. A test holds each pattern to a file in
 * the installed Next.js, so a release that renames one fails there.
 *
 * @module next-runtime-includes
 */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";

/** The packages whose files are listed, each its own patterns. */
export type RuntimePackage =
  | "next"
  | "react-dom"
  | "react"
  | "styled-jsx"
  | "client-only";

/** Patterns inside each package, relative to the package's own directory. */
export const NEXT_RUNTIME_PATTERNS: Readonly<
  Record<RuntimePackage, readonly string[]>
> = {
  next: [
    "cache.js",
    "headers.js",
    "navigation.js",
    "server.js",
    "dist/build/output/log.js",
    "dist/client/components/*.js",
    // The pages router's runtime, which the vendored contexts read: one per
    // bundler, chosen when the server starts.
    "dist/compiled/next-server/pages-turbo.runtime.prod.js",
    "dist/compiled/next-server/pages.runtime.prod.js",
    "dist/compiled/ua-parser-js/*.js",
    "dist/lib/batcher.js",
    "dist/server/after/*.js",
    "dist/server/base-http/helpers.js",
    "dist/server/create-deduped-by-callsite-server-error-logger.js",
    "dist/server/lib/clone-response.js",
    "dist/server/lib/dedupe-fetch.js",
    "dist/server/lib/encode-header-safe.js",
    "dist/server/lib/patch-fetch*.js",
    "dist/server/lib/trace/**/*.js",
    "dist/server/pipe-readable.js",
    "dist/server/render-result.js",
    "dist/server/request-meta.js",
    "dist/server/request/**/*.js",
    "dist/server/response-cache/**/*.js",
    "dist/server/route-modules/pages/**/*.js",
    "dist/server/stream-utils/**/*.js",
    "dist/server/use-cache/**/*.js",
    "dist/server/web/*.js",
    "dist/server/web/spec-extension/**/*.js",
    "dist/shared/lib/errors/*.js",
    "dist/shared/lib/get-hostname.js",
    "dist/shared/lib/hash.js",
    "dist/shared/lib/i18n/*.js",
    "dist/shared/lib/request-insights.js",
    "dist/shared/lib/router/utils/**/*.js",
  ],
  "react-dom": [
    "server.edge.js",
    "cjs/react-dom-server.edge.production.js",
    "cjs/react-dom-server-legacy.browser.production.js",
  ],
  react: ["jsx-runtime.js", "cjs/react-jsx-runtime.production.js"],
  "styled-jsx": ["index.js", "style.js", "dist/index/**/*.js"],
  "client-only": ["index.js"],
};

/**
 * Which package requires each one at run time, so each is resolved where that
 * require looks: under pnpm, `react-dom` is the copy beside `next` in the
 * store, which need not be the app's own.
 */
const REQUIRED_FROM: Readonly<Record<RuntimePackage, RuntimePackage | null>> = {
  next: null,
  "react-dom": "next",
  react: "next",
  "styled-jsx": "next",
  "client-only": "styled-jsx",
};

/**
 * A package's directory, found from its entry point: some packages export no
 * `./package.json`, so resolving that is not an option.
 */
function packageDir(require: NodeJS.Require, name: string): string | null {
  let entry: string;
  try {
    entry = require.resolve(name);
  } catch {
    return null;
  }
  const marker = `${sep}node_modules${sep}${name}${sep}`;
  const at = entry.lastIndexOf(marker);
  return at === -1 ? null : entry.slice(0, at + marker.length - 1);
}

/** Where one package is, as the project links it and as it resolves. */
export interface RuntimePackageDirs {
  /** `node_modules/<name>` in the project, as the project sees it. */
  linked: string;
  /** The package's real directory: under pnpm, its folder in the store. */
  real: string;
}

/**
 * Each package's directories, resolved from the package that requires it at
 * run time. A package that cannot be found is left out: there is nothing to
 * ship for it, and loading a config must not fail over it.
 */
export function runtimePackageDirs(
  projectDir: string
): Partial<Record<RuntimePackage, RuntimePackageDirs>> {
  const fromProject = createRequire(join(projectDir, "package.json"));
  const out: Partial<Record<RuntimePackage, RuntimePackageDirs>> = {};
  for (const [name, parent] of Object.entries(REQUIRED_FROM) as Array<
    [RuntimePackage, RuntimePackage | null]
  >) {
    const parentDir = parent === null ? undefined : out[parent]?.real;
    if (parent !== null && parentDir === undefined) continue;
    const require =
      parentDir === undefined
        ? fromProject
        : createRequire(join(parentDir, "package.json"));
    const found = packageDir(require, name);
    if (found === null) continue;
    out[name] = {
      linked: join(projectDir, "node_modules", name),
      real: realpathSync(found),
    };
  }
  return out;
}

/** A path as a glob relative to the project, where Next.js runs the globs. */
function projectGlob(projectDir: string, path: string): string | null {
  const rel = relative(projectDir, path);
  // A store on another drive has no relative path.
  if (isAbsolute(rel)) return null;
  const posix = rel.split(sep).join("/");
  return posix.startsWith("../") ? posix : `./${posix}`;
}

/**
 * The globs for the Next.js runtime files, relative to `projectDir`. Each
 * pattern is given twice: under `node_modules/<pkg>` as the project sees it,
 * and under the package's real directory, which is the path a require from
 * Nextly's own files resolves to under pnpm and where a monorepo hoists it.
 */
export function nextRuntimeIncludes(projectDir: string): string[] {
  const globs = new Set<string>();
  const dirs = runtimePackageDirs(projectDir);
  for (const [name, found] of Object.entries(dirs) as Array<
    [RuntimePackage, RuntimePackageDirs]
  >) {
    for (const pattern of NEXT_RUNTIME_PATTERNS[name]) {
      for (const base of [found.linked, found.real]) {
        const glob = projectGlob(projectDir, join(base, pattern));
        if (glob !== null) globs.add(glob);
      }
    }
  }
  return [...globs];
}

/**
 * Packages that must be explicitly included in the Vercel Lambda
 * output via `outputFileTracingIncludes`.
 *
 * pnpm's strict `.pnpm` store uses symlinks for peer deps, but
 * Vercel's Lambda filesystem doesn't always follow symlink chains.
 * This forces Next.js/NFT to copy these packages into the Lambda
 * regardless of whether tracing resolves them.
 */
const DATABASE_TRACING_INCLUDES = [
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
 * Every file Nextly needs in a deployed function that a build trace may leave
 * out: the database drivers and adapters, and the Next.js runtime files it
 * loads at request time. `withNextly` adds them to every route; a config not
 * wrapped in it adds them itself:
 *
 * ```ts
 * import { nextlyTracingIncludes } from "nextly/next";
 * const nextConfig = {
 *   outputFileTracingIncludes: { "/**": nextlyTracingIncludes() },
 * };
 * ```
 *
 * @param projectDir - The app's root, where Next.js runs the globs. Defaults
 *   to the directory Next.js loads the config in.
 */
export function nextlyTracingIncludes(
  projectDir: string = process.cwd()
): string[] {
  return [...DATABASE_TRACING_INCLUDES, ...nextRuntimeIncludes(projectDir)];
}
