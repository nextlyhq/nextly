/**
 * The options both routes over `block-pages` share: the public one at
 * `/blocks`, and the preview one at `/preview/blocks` that adds a draft gate.
 *
 * One declaration, because the two routes draw the same documents and a page
 * that rendered differently at its preview address than at its public one
 * would preview something the public never sees.
 *
 * @module lib/block-pages-route
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { BlocksPageConfig } from "@nextlyhq/blocks-react/next";
import { loadSiteStyle, SITE_STYLE_SLUG } from "@nextlyhq/plugin-page-builder";

import { siteReader, SITE_STYLE_CONTEXT } from "./site-content";
import { SITE_STYLE_DEFAULTS } from "./site-style-defaults";

/**
 * Where the public route is mounted, for canonical URLs: a preview's
 * canonical is the public address too, since that is where the page lives.
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

export const blockPagesRoute: BlocksPageConfig = {
  collections: ["block-pages"],
  field: "content",
  nextly: siteReader,
  // Where the route's catch-all is mounted, so a paginated list's links and
  // its `/page/1` redirect name `/blocks/...` rather than the site root.
  mountPath: MOUNT,
  // Stated even though it is this site's default language, because the read is
  // not the only thing it feeds: it is also what a `draft` decision compares a
  // preview token against, and a token always names a resolved locale rather
  // than a blank one.
  locale: "en",
  // An explicit set, not the process registry. `registeredBlocks()` reads the
  // engine's global registry, which is populated by whatever booted the
  // editor — so a route depending on it renders the unknown-block placeholder
  // whenever this request arrived before the admin did.
  blocks: createBlockResolver(coreBlocks),
  // No `data`: a `core/collection-loop` reads through the route's public
  // reader, published entries and public fields only, as any visitor would.
  styleContext: SITE_STYLE_CONTEXT,
  // Resolved per request: defaults with the stored Site Style layered on top.
  // The same statement the page-builder route makes, because both routes serve
  // documents of one engine and a site sheet that differed between them would
  // style one page two ways depending on its URL.
  siteStyles: {
    read: () =>
      loadSiteStyle({ nextly: siteReader, defaults: SITE_STYLE_DEFAULTS }),
    // What that read depends on. A cached render is rebuilt only by a tag it
    // carries, and the Direct API read inside `read` contributes none, so the
    // single is named.
    singles: [SITE_STYLE_SLUG],
  },
  metadata: (entry, _context, derived) => ({
    title: derived.title ?? (entry.title as string | undefined),
    description: derived.description,
    ...(derived.canonical
      ? { alternates: { canonical: canonicalFor(derived.canonical) } }
      : {}),
    ...(derived.image
      ? { openGraph: { images: [{ url: derived.image }] } }
      : {}),
  }),
};
