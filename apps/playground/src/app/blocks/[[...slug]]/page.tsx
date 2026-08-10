/**
 * Public route for the code-first blocks renderer.
 *
 * The whole route is `createBlocksPage` plus the re-exports Next wants — there
 * is no per-request wiring here, which is the point of the helper.
 *
 * The document this renders is a `@nextlyhq/blocks-engine` `BlockDocument`, NOT
 * the page builder's `BlockNode`. They are different shapes (`styles` and a
 * `visibility` that may carry conditions, against `style`/`styleHover` and a
 * per-breakpoint boolean map), so this route and the page builder's
 * `(site)/[...slug]` route are not interchangeable and neither can read the
 * other's rows. That is why this reads its own collection.
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { getNextly } from "nextly";
import type { NextlyContentReader } from "nextly/runtime";

import nextlyConfig from "../../../../nextly.config";

/**
 * The route's reader, resolved per call.
 *
 * `createBlocksPage` otherwise falls back to the synchronous `getNextly()` from
 * `nextly/runtime`, which returns the already-registered singleton and throws
 * when nothing has registered it. A public page can be the FIRST request a cold
 * server handles, so relying on that means the route works only once something
 * else has booted the CMS — in this app, a visit to `/admin`.
 *
 * Async boot cannot happen where the config is captured (module scope), so the
 * indirection is per call rather than a value. `getNextly` caches its instance,
 * so every call after the first is a lookup.
 */
const reader: NextlyContentReader = {
  find: async args => (await getNextly({ config: nextlyConfig })).find(args),
  findByID: async args =>
    (await getNextly({ config: nextlyConfig })).findByID(args),
};

/**
 * Where this route is mounted, for canonical URLs.
 *
 * `derived.canonical` is the entry's path within its collection, already
 * rooted (`/about/team`, or `/` for the collection's root entry), because the
 * helper resolves slugs and does not know which segment of the app it was
 * wired under. Prefixing is the host's job, and getting it wrong is how a page
 * comes to claim it lives somewhere nothing is served.
 */
const MOUNT = "/blocks";

/**
 * The mount plus the entry's own path.
 *
 * The root entry's path is `/`, and concatenating it would emit `/blocks/` for
 * a page Next serves at `/blocks` — a canonical that names a redirect rather
 * than the page describing itself.
 */
function canonicalFor(path: string): string {
  return path === "/" ? MOUNT : `${MOUNT}${path}`;
}

/**
 * Rendered per request, never prerendered at build.
 *
 * The same reason `(site)/[...slug]` gives: this repository's build environment
 * has no database, and `generateStaticParams` reads one to learn which paths
 * exist. Without this the playground build fails with "Failed to collect page
 * data" — not because the route is wrong, but because a build box has nothing
 * to collect from.
 *
 * A deployed site whose build CAN reach its database wants the opposite, and
 * `createBlocksPage` returns `generateStaticParams` for exactly that. It is not
 * re-exported here because `force-dynamic` makes Next ignore it, and an export
 * that does nothing invites the next reader to conclude that static generation
 * was tried and did not work.
 */
export const dynamic = "force-dynamic";

const { ContentPage, generateMetadata } = createBlocksPage({
  collections: ["block-pages"],
  field: "content",
  nextly: reader,
  // An explicit set, not the process registry. `registeredBlocks()` reads the
  // engine's global registry, which is populated by whatever booted the
  // editor — so a public route depending on it renders the unknown-block
  // placeholder whenever this request arrived before the admin did.
  blocks: createBlockResolver(coreBlocks),
  metadata: (entry, context, derived) => ({
    title: derived.title ?? (entry.title as string | undefined),
    description: derived.description,
    ...(derived.canonical
      ? { alternates: { canonical: canonicalFor(derived.canonical) } }
      : {}),
    ...(derived.image
      ? { openGraph: { images: [{ url: derived.image }] } }
      : {}),
  }),
});

export { generateMetadata };
export default ContentPage;
