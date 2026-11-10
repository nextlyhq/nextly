/**
 * The public page-builder route: every page an author builds, and every post,
 * served at its own URL.
 *
 * This is the address-store model. One route file answers ANY path from the
 * page builder's address store, which every save writes in its own
 * transaction: a path a published page holds renders the page, and a path a
 * published post holds (`/blog/<slug>`, declared in `nextly.config.ts`) renders
 * the Posts template with the post as its entry. So an author who publishes a
 * page with the slug `about` has `/about` live immediately, and a post is live
 * at its address the moment it and its template are published. Adding either
 * needs no developer, no route file and no deploy, which is the whole reason a
 * page builder exists. Because the store that refuses two documents one
 * address is also what routes, what is checked is what is served.
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
import { createContentPage } from "@nextlyhq/blocks-react/next";
import { pageBuilderContent } from "@nextlyhq/plugin-page-builder";
import { previewDraftGate } from "nextly/runtime";

import { withJournalLinks } from "../../../blog-fixture/links";
import { withJournalMetadata } from "../../../blog-fixture/metadata";
import { pagesRoute } from "../../../lib/pages-route";
import { siteReader } from "../../../lib/site-content";

/**
 * Who holds each path, and the Posts template, from the page builder, through
 * the process's own instance, which offers the plugin's services.
 */
const content = pageBuilderContent();

/**
 * The browser suite's blog fixture (`src/blog-fixture`), by the same switch
 * that registers its collections: its author, category and tag links name the
 * hand-written blog's routes, and its posts' metadata is the hand-written
 * page's. Off, the route is exactly the page builder's.
 */
const blogFixture = process.env.NEXTLY_E2E_STYLE_FIXTURE === "1";

/**
 * Access-enforced and per-request, which is the secure default.
 *
 * `createContentPage` reads as the visitor would, so the answer depends on who
 * is asking and no path can be pre-rendered. It returns no
 * `generateStaticParams`, Next classifies the route dynamic because nothing
 * claims otherwise, and the build reads no database — which is what lets this
 * app build on a machine that has none.
 *
 * A site whose pages are wholly public calls `createPublicContentPage` instead
 * and exports the `generateStaticParams` it returns, pairing it with `tags` so
 * publishing busts the cached page rather than waiting for a rebuild. That is
 * the right posture for a marketing site and the wrong one here: it needs a
 * database during `next build`. The posture is the factory you call, not an
 * option you pass. `/site` serves the same pages that way (`../site`).
 */
const { ContentPage, generateMetadata } = createContentPage({
  ...content,
  ...(blogFixture
    ? { entryPath: withJournalLinks(content.entryPath, siteReader) }
    : {}),
  pages: {
    ...pagesRoute,
    ...(blogFixture
      ? { metadata: withJournalMetadata(pagesRoute.metadata) }
      : {}),
    // Without this the route serves published pages only, so a preview link
    // verifies, redirects, and then answers 404 from a page that looks
    // entirely correct — indistinguishable, to the reviewer who opened it,
    // from a link that had expired. A draft holds no address, so the route
    // asks this gate for a path nothing holds.
    //
    // The gate grants exactly the ONE entry the visitor's token names. That
    // is the part Next's own draft mode cannot express: `draftMode()` is a
    // single boolean for the whole host, so enabling it alone would turn a
    // link meant for one unpublished page into a key to every unpublished
    // page on the site.
    draft: previewDraftGate(),
  },
});

export { generateMetadata };
export default ContentPage;
