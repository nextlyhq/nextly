/**
 * The public page-builder route: every page an author builds, served at its own
 * URL.
 *
 * This is the pages-collection model. One route file resolves ANY path against
 * the `pages` collection the page builder contributes, so an author who creates
 * a page with the slug `about` and publishes it has `/about` live immediately.
 * Adding a page needs no developer, no route file and no deploy, which is the
 * whole reason a page builder exists.
 *
 * ## Why a REQUIRED catch-all, not an optional one
 *
 * `[...slug]` matches `/about` and `/pricing/enterprise` but never `/`, whereas
 * `[[...slug]]` would also match the root. This app already serves `/` from
 * `app/page.tsx`, which redirects contributors to the admin, and two routes
 * resolving the same path is a build error rather than a precedence question. A
 * real site with a public home page uses the optional form and drops that
 * redirect.
 *
 * ## Why it sits inside `(frontend)`
 *
 * A route group is parentheses on disk and nothing in the URL. It keeps public
 * pages separate from `/admin` in the tree, and it keeps this catch-all out of
 * the app root, where an optional catch-all conflicts with sibling routes. The
 * name matches `templates/blog`, so both surfaces group public pages the same
 * way.
 *
 * ## Why this does not swallow `/blocks` or `/admin`
 *
 * Two independent reasons, and both matter. Next resolves static segments
 * before dynamic ones, so `/blocks/x` reaches the route that declares that
 * segment. Independently, the helper refuses a reserved path outright, so a
 * page stored with the slug `admin` 404s here instead of shadowing the panel —
 * the routing table is not the only thing standing between an author and the
 * admin URL.
 *
 * @module app/(frontend)/[...slug]
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { previewDraftGate } from "nextly/runtime";

import {
  siteDataProvider,
  siteReader,
  SITE_STYLE_CONTEXT,
  SITE_STYLES,
} from "../../../lib/site-content";

/**
 * Access-enforced and per-request, which is the secure default.
 *
 * `createBlocksPage` reads as the visitor would, so the answer depends on who
 * is asking and no path can be pre-rendered. It returns no
 * `generateStaticParams`, Next classifies the route dynamic because nothing
 * claims otherwise, and the build reads no database — which is what lets this
 * app build on a machine that has none.
 *
 * A site whose pages are wholly public calls `createPublicBlocksPage` instead
 * and exports the `generateStaticParams` it returns, pairing it with `tags` so
 * publishing busts the cached page rather than waiting for a rebuild. That is
 * the right posture for a marketing site and the wrong one here: it needs a
 * database during `next build`. The posture is the factory you call, not an
 * option you pass.
 */
const { ContentPage, generateMetadata } = createBlocksPage({
  // The collection the page builder plugin contributes. It already carries
  // `title`, a unique `slug` and a Draft/Published lifecycle, so an unpublished
  // page 404s here rather than rendering.
  collections: ["pages"],
  // Named rather than defaulted: guessing a field renders a blank page instead
  // of an error, which is the least debuggable outcome available.
  field: "content",
  nextly: siteReader,
  // Stated even though it is this site's default language. An omitted locale
  // still serves the right page, but it is also what a `draft` decision would
  // compare a preview token against, and a token always names a resolved locale
  // rather than a blank one. Omitting it leaves the next change that adds a
  // preview gate refusing every default-language preview, behind a published
  // page that looks entirely correct.
  locale: "en",
  // Without this the route serves published entries only, so a preview link
  // verifies, redirects, and then answers 404 from a page that looks entirely
  // correct — indistinguishable, to the reviewer who opened it, from a link
  // that had expired.
  //
  // The gate grants exactly the ONE entry the visitor's token names. That is
  // the part Next's own draft mode cannot express: `draftMode()` is a single
  // boolean for the whole host, so enabling it alone would turn a link meant
  // for one unpublished page into a key to every unpublished page on the site.
  draft: previewDraftGate(),
  // An explicit set, not the process registry. `registeredBlocks()` reads the
  // engine's global registry, which is populated by whatever booted the editor
  // — so a public route depending on it renders the unknown-block placeholder
  // whenever this request arrived before the admin did.
  blocks: createBlockResolver(coreBlocks),
  // What a `core/collection-loop` reads. Without it `createStandaloneContext`
  // installs `emptyDataProvider`, which answers every query with nothing — so a
  // block an author inserted from the palette renders as an empty container on
  // a page that is otherwise entirely correct, and nothing reports it.
  //
  // The SAME provider the `/blocks` route uses, rather than a second one built
  // here: it reads as the visitor with `overrideAccess: false` and
  // `status: "published"`, and a route that assembled its own would be one
  // rewrite away from a trusted read serving drafts to anyone with a URL.
  data: siteDataProvider,
  styleContext: SITE_STYLE_CONTEXT,
  // The one provider, shared with the two single-page routes so all three
  // resolve their tokens the same way. See `SITE_STYLES`.
  siteStyles: SITE_STYLES,
  metadata: (entry, context, derived) => ({
    title: derived.title ?? (entry.title as string | undefined),
    description: derived.description,
    // `derived.canonical` is the entry's path within its collection, already
    // rooted. This route is mounted at the site root, so it needs no prefix —
    // unlike `/blocks`, which prepends its own mount.
    ...(derived.canonical
      ? { alternates: { canonical: derived.canonical } }
      : {}),
    ...(derived.image
      ? { openGraph: { images: [{ url: derived.image }] } }
      : {}),
  }),
});

export { generateMetadata };
export default ContentPage;
