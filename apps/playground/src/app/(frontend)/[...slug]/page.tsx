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
 * ## Why it is cached, and how a preview is served
 *
 * A published page is the same for every visitor, so this route answers a
 * visit from the cache: each published path is built ahead of time, and a
 * publish or unpublish of the page, its Layout's header or footer, a
 * component it places or the site style refreshes the cached answer by its
 * tags. A preview link turns on Next's draft mode, and only a draft-mode
 * request asks the draft gate below; Next renders those on demand and never
 * stores them, so a draft never reaches the cache or another visitor.
 *
 * Pre-rendering reads the database during `next build`, which is what the
 * cached posture costs.
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
import { createPublicContentPage } from "@nextlyhq/blocks-react/next";
import { pageBuilderContent } from "@nextlyhq/plugin-page-builder";
import { previewDraftGate } from "nextly/runtime";

import { withJournalLinks } from "../../../blog-fixture/links";
import { withJournalMetadata } from "../../../blog-fixture/metadata";
import { pagesRoute } from "../../../lib/pages-route";
import { siteReader } from "../../../lib/site-content";
import { pathsOrRoot } from "../../../lib/static-params";

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
 * Public and cached: read trusted, as every visitor reads it, built ahead of
 * time and refreshed by its tags. A preview asks the draft gate, and only on a
 * draft-mode request.
 */
const route = createPublicContentPage({
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

/**
 * Every path a published page or entry holds, built ahead of time. With none
 * published yet, one path no page holds, which renders the not-found page: a
 * required catch-all cannot build the root.
 */
export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  return pathsOrRoot(route, { slug: ["not-found"] });
}

export const { generateMetadata } = route;
export default route.ContentPage;
