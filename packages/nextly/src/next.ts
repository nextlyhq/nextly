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
 * import { withNextly } from "@revnixhq/nextly/next";
 *
 * export default withNextly({
 *   // your Next.js config
 * });
 * ```
 */

/**
 * Packages that must be loaded from node_modules at runtime
 * instead of being bundled by Next.js.
 *
 * These are server-only packages that use native Node.js features
 * (TCP sockets, native bindings, etc.) incompatible with bundling.
 */
const NEXTLY_SERVER_EXTERNAL_PACKAGES = [
  // Nextly core and adapters
  "@revnixhq/nextly",
  "@revnixhq/adapter-drizzle",
  "@revnixhq/adapter-postgres",
  "@revnixhq/adapter-mysql",
  "@revnixhq/adapter-sqlite",
  // Database drivers
  "pg",
  "mysql2",
  "better-sqlite3",
  // ORM
  "drizzle-orm",
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
  "./node_modules/@revnixhq/adapter-postgres/**/*",
  "./node_modules/@revnixhq/adapter-mysql/**/*",
  "./node_modules/@revnixhq/adapter-sqlite/**/*",
  "./node_modules/@revnixhq/adapter-drizzle/**/*",
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
 * import { withNextly } from "@revnixhq/nextly/next";
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
 * import { withNextly } from "@revnixhq/nextly/next";
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
  const existing =
    (nextConfig.serverExternalPackages as string[] | undefined) ?? [];

  // Merge without duplicates
  const merged = [
    ...new Set([...existing, ...NEXTLY_SERVER_EXTERNAL_PACKAGES]),
  ];

  // Force-include database packages in Vercel Lambda output.
  // pnpm's strict .pnpm store uses symlinks for peer deps, but
  // Vercel's Lambda filesystem doesn't follow symlink chains.
  const existingExperimental =
    (nextConfig.experimental as Record<string, unknown> | undefined) ?? {};
  const existingIncludes =
    (existingExperimental.outputFileTracingIncludes as Record<
      string,
      string[]
    >) ?? {};
  const existingCatchAll = existingIncludes["/**"] ?? [];

  return {
    ...nextConfig,
    serverExternalPackages: merged,
    experimental: {
      ...existingExperimental,
      outputFileTracingIncludes: {
        ...existingIncludes,
        "/**": [
          ...new Set([...existingCatchAll, ...NEXTLY_FILE_TRACING_INCLUDES]),
        ],
      },
    },
  };
}
