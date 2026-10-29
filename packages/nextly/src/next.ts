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

import { warnIfCacheComponentsOn } from "./cache-components";

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
 * Wraps a Next.js config to add Nextly-required settings.
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
export function withNextly<T extends Record<string, unknown>>(
  nextConfig: T
): T {
  // Read while Next.js loads the config, before anything builds or serves:
  // the earliest place an app with Cache Components on can be told why.
  warnIfCacheComponentsOn(nextConfig.cacheComponents, "this next.config");

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
