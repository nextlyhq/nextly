/**
 * The fixture's Next.js config, read at build and at start.
 *
 * `FIXTURE_CACHE_COMPONENTS=1` turns Cache Components on. `FIXTURE_SHARED_HANDLERS=0`
 * leaves Next.js's default caches in place; otherwise both of Nextly's cache
 * handlers are installed as its guide says, the incremental one with the
 * in-memory cache off so every read asks it, which is what lets one instance
 * learn of another's write through the database.
 */
import { createRequire } from "node:module";

import { withNextly } from "nextly/next";

const require = createRequire(import.meta.url);

const sharedHandlers = process.env.FIXTURE_SHARED_HANDLERS !== "0";

export default withNextly({
  // In this workspace `nextly` is a link to packages/nextly rather than an
  // installed package, and Turbopack bundles a linked package even when it is
  // listed as external, the playground's production build included. So these
  // two, which nextly's config loader requires and which cannot be bundled,
  // are named here as the playground names them. The handlers and the bundled
  // copy share their state through `globalThis`, as two copies in one process
  // are meant to.
  serverExternalPackages: ["esbuild", "bundle-require"],
  cacheComponents: process.env.FIXTURE_CACHE_COMPONENTS === "1",
  ...(sharedHandlers
    ? {
        cacheHandler: require.resolve("nextly/cache-handler"),
        cacheMaxMemorySize: 0,
        cacheHandlers: { default: require.resolve("nextly/cache-handlers") },
      }
    : {}),
});
