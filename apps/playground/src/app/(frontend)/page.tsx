/**
 * The site's home page, built in the page builder.
 *
 * A Single rather than a collection entry, because there is exactly one home
 * page and its address is not something an author invents: `/` is fixed. That is
 * the whole distinction between the two mounts. Anything an author might want a
 * SECOND of belongs in the `pages` collection next door, where creating one
 * needs no developer and no deploy.
 *
 * ## Why this replaced a redirect
 *
 * `/` used to send contributors straight to `/admin`, which no real Nextly site
 * would do — so the app's own root was the one URL that demonstrated nothing.
 * Reaching the panel is now an ordinary visit to `/admin`.
 *
 * @module app/(frontend)/page
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createSinglePage } from "@nextlyhq/blocks-react/next";

import {
  siteReader,
  SITE_STYLE_CONTEXT,
  SITE_STYLES,
  singleMetadata,
} from "../../lib/site-content";

/**
 * Access-enforced, matching the collection route beside it.
 *
 * `createPublicSinglePage` is the cached twin and is what a marketing site
 * wants, but it renders during `next build` and therefore needs a reachable
 * database — which this app deliberately does not require in order to build.
 * The posture is the factory called, never an option passed.
 */
const { SinglePage, generateMetadata } = createSinglePage({
  slug: "homepage",
  // The `blocks()` field on the Homepage single. Named rather than guessed: a
  // wrong name renders a blank page instead of raising, which is the least
  // debuggable outcome available.
  field: "layout",
  nextly: siteReader,
  // Stated even though it is this site's default language, for the same reason
  // the collection route states it: nothing infers the default on your behalf,
  // because inferring it means reading configuration at request time and a
  // reader may defer booting until its first query.
  locale: "en",
  // An explicit set rather than the process registry, which is populated by
  // whatever booted the editor — so a public route depending on it draws the
  // unknown-block placeholder whenever a visitor arrives before an admin does.
  blocks: createBlockResolver(coreBlocks),
  styleContext: SITE_STYLE_CONTEXT,
  siteStyles: SITE_STYLES,
  metadata: singleMetadata,
});

export { generateMetadata };
export default SinglePage;
