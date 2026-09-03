/**
 * Public route for the CODE-FIRST blocks renderer.
 *
 * The whole route is `createBlocksPage` plus the re-exports Next wants — there
 * is no per-request wiring here, which is the point of the helper.
 *
 * ## What makes this different from the page-builder route
 *
 * Not the document. Both store the engine's `BlockDocument`: `blocks()` declares
 * `storage: "json"` exactly as `json()` does, and there is one `BlockDocument`
 * in the repo. A document authored here renders there and vice versa.
 *
 * The difference is who WRITES it. `block-pages` holds its document in a plain
 * `json` field, so it is authored in code or by an API client and has no editor
 * attached — which is the path a developer takes who wants blocks without the
 * page builder installed. `(frontend)/[...slug]` reads the plugin's `pages`
 * collection, whose `blocks()` field mounts the visual editor.
 *
 * Keeping both is deliberate: converting this collection's field would leave
 * nothing covering the code-authored path.
 *
 * @module app/blocks/[[...slug]]
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { loadSiteStyle, SITE_STYLE_SLUG } from "@nextlyhq/plugin-page-builder";
import { previewDraftGate } from "nextly/runtime";

import {
  siteDataProvider,
  siteReader,
  SITE_STYLE_CONTEXT,
} from "../../../lib/site-content";
import { SITE_STYLE_DEFAULTS } from "../../../lib/site-style-defaults";

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
 * No `force-dynamic`, and nothing to pre-render.
 *
 * `createBlocksPage` reads access-enforced content — the secure default — so
 * the answer depends on who is asking and no path can be pre-rendered. It hands
 * back no `generateStaticParams` at all, Next classifies the route dynamic
 * because nothing claims otherwise, and the build reads no database.
 *
 * It used to need `export const dynamic = "force-dynamic"` to survive a build
 * box with no database. That is now handled by the shape of what the helper
 * returns rather than by a flag the host has to remember.
 *
 * A site whose content IS public calls `createPublicBlocksPage` instead, which
 * reads trusted and returns a `generateStaticParams` to export alongside these
 * two. The posture is the factory you call — there is no option for it.
 */
const { ContentPage, generateMetadata } = createBlocksPage({
  collections: ["block-pages"],
  field: "content",
  nextly: siteReader,
  // Without this the route serves published entries only, so a preview link
  // verifies, redirects, and then answers 404 from a page that looks entirely
  // correct — indistinguishable, to the reviewer who opened it, from a link
  // that had expired.
  //
  // The gate grants exactly the ONE entry the visitor's token names, which is
  // the part Next's own draft mode cannot express: `draftMode()` is a single
  // boolean for the whole host, so enabling it alone would turn a link meant
  // for one unpublished page into a key to every unpublished page on the site.
  draft: previewDraftGate(),
  // Stated even though it is this site's default language, because the read is
  // not the only thing it feeds. An omitted locale still serves the right page
  // — the read defaults it internally — but it is also what a `draft` decision
  // compares a preview token against, and a token always names a resolved
  // locale rather than a blank one. Omitting it here would leave the next route
  // that adds a preview gate refusing every default-language preview, behind a
  // published page that looks entirely correct.
  locale: "en",
  // An explicit set, not the process registry. `registeredBlocks()` reads the
  // engine's global registry, which is populated by whatever booted the
  // editor — so a public route depending on it renders the unknown-block
  // placeholder whenever this request arrived before the admin did.
  blocks: createBlockResolver(coreBlocks),
  // Without this every `core/collection-loop` in a stored document answers with
  // nothing: the default context installs `emptyDataProvider`, so the block
  // draws its container and no entries, and a page that says it lists posts
  // renders an empty box. The helper caps the reads per render, so supplying a
  // real provider does not make a document's nesting unbounded.
  data: siteDataProvider,
  styleContext: SITE_STYLE_CONTEXT,
  // Resolved per request: defaults with the stored Site Style layered on top.
  // The same statement the page-builder route makes, because both routes serve
  // documents of one engine and a site sheet that differed between them would
  // style one page two ways depending on its URL.
  siteStyles: {
    read: () =>
      loadSiteStyle({ nextly: siteReader, defaults: SITE_STYLE_DEFAULTS }),
    // What that read depends on. This route is cacheable, so the whole render
    // is what is cached and only a tag it carries rebuilds it — and the Direct
    // API read inside `read` contributes none. Without naming the single, an
    // admin's save would invalidate a tag no cache entry here holds and the
    // page would keep serving the old sheet.
    singles: [SITE_STYLE_SLUG],
  },
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
