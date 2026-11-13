/**
 * The Next.js files Nextly loads at request time that a build trace may leave
 * out.
 *
 * Nextly is a server external, so its `dist` is plain Node code that the build
 * traces file by file. It reaches Next.js through `createRequire`, which
 * keeps Next.js out of a consumer that is not a Next.js app: Next's
 * server-side `navigation.react-server.js` for not-found and redirects (see
 * `runtime/next-api.ts`), `next/cache` for cached reads and revalidation,
 * `next/headers` and `next/server` for request headers, `after()` and
 * `connection()`. A tracer that does not follow those requires leaves their
 * files out, and the app's own imports of the same modules are bundled into
 * its chunks, so nothing else ships them. A host that deploys each function
 * with only its traced files (Vercel) then fails the first request that needs
 * one with "Cannot find module", while `next start` over a whole
 * `node_modules` never shows it. So `withNextly` adds them to every route's
 * `outputFileTracingIncludes`, and {@link nextlyTracingIncludes} hands the
 * same list to a config that is not wrapped in it.
 *
 * Every file listed is inside the `next` package, and each requires the next
 * by a relative path or by `next/...` from within `next` itself, so shipping
 * the package's own files is enough: no link into another package has to be
 * recreated. That holds because Nextly loads the server entry of
 * `next/navigation`, not the client one, which Next's require hook sends on to
 * the pages router's runtime, `react-dom`, `styled-jsx` and `client-only`
 * through pnpm's links. `react`, which the server entry also requires, is
 * already in every App Router function.
 *
 * The patterns come from the require graph of a production server answering
 * through those four entries: the files its traces left out. Directories are
 * named where a file's neighbours are as likely to be loaded by the next
 * Next.js release, single files where the directory is large. A test holds
 * each pattern to a file in the installed Next.js, so a release that renames
 * one fails there.
 *
 * @module next-runtime-includes
 */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";

/** Patterns inside the `next` package, relative to its directory. */
export const NEXT_RUNTIME_PATTERNS: readonly string[] = [
  "cache.js",
  "headers.js",
  "navigation.js",
  "server.js",
  "dist/build/output/log.js",
  "dist/client/components/*.js",
  "dist/client/components/http-access-fallback/*.js",
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
];

/** Where the `next` package is, as the project links it and as it resolves. */
export interface NextPackageDirs {
  /** `node_modules/next` in the project, as the project sees it. */
  linked: string;
  /** The package's real directory: under pnpm, its folder in the store. */
  real: string;
}

/**
 * The `next` package's directories, resolved from the project; null where it
 * cannot be found, since loading a config must not fail over it. Found from
 * its entry point, the way a require of it resolves.
 */
export function nextPackageDirs(projectDir: string): NextPackageDirs | null {
  let entry: string;
  try {
    entry = createRequire(join(projectDir, "package.json")).resolve("next");
  } catch {
    return null;
  }
  const marker = `${sep}node_modules${sep}next${sep}`;
  const at = entry.lastIndexOf(marker);
  if (at === -1) return null;
  return {
    linked: join(projectDir, "node_modules", "next"),
    real: realpathSync(entry.slice(0, at + marker.length - 1)),
  };
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
 * pattern is given twice: under `node_modules/next` as the project sees it,
 * and under the package's real directory, which is the path a require from
 * Nextly's own files resolves to under pnpm and where a monorepo hoists it.
 */
export function nextRuntimeIncludes(projectDir: string): string[] {
  const dirs = nextPackageDirs(projectDir);
  if (!dirs) return [];
  const globs = new Set<string>();
  for (const pattern of NEXT_RUNTIME_PATTERNS) {
    for (const base of [dirs.linked, dirs.real]) {
      const glob = projectGlob(projectDir, join(base, pattern));
      if (glob !== null) globs.add(glob);
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
