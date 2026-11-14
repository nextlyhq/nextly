/**
 * The SEO site's Next.js config, read at build and at start: `withNextly`, so
 * `/robots.txt`, `/sitemap.xml` and `/llms.txt` are rewritten to the plugin as
 * on any Nextly site; Next.js's `global-not-found` page for addresses no route
 * matches; and Cache Components with Nextly's cache handlers, as
 * `create-nextly-app` sets them up, the only arrangement Nextly supports.
 */
import { createRequire } from "node:module";

import { withNextly } from "nextly/next";

const require = createRequire(import.meta.url);

/** The local worker limit a bounded run sets, as the playground reads it; unset in CI. */
const workers = Number(process.env.NEXTLY_LOCAL_MAX_WORKERS);

export default withNextly({
  // In this workspace `nextly` is a link to packages/nextly rather than an
  // installed package, and Turbopack bundles a linked package even when it is
  // listed as external. These two, which nextly's config loader requires and
  // which cannot be bundled, are named as the multi-instance fixture names
  // them; the adapter is loaded by a dynamic import, so it stays external.
  serverExternalPackages: [
    "esbuild",
    "bundle-require",
    "@nextlyhq/adapter-drizzle",
    "@nextlyhq/adapter-sqlite",
    "better-sqlite3",
    "sharp",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    globalNotFound: true,
    ...(Number.isInteger(workers) && workers > 0 ? { cpus: workers } : {}),
  },
  cacheHandler: require.resolve("nextly/cache-handler"),
  cacheMaxMemorySize: 0,
  cacheHandlers: { default: require.resolve("nextly/cache-handlers") },
});
