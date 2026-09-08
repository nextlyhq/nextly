/**
 * The Landing Page single, rendered as a blocks page.
 *
 * A Single rather than a collection entry, for the same reason the home page is
 * one: there is exactly one landing page and its address is fixed, so nothing
 * about it is looked up by slug.
 *
 * What it adds beside `(frontend)/page.tsx` is a publish lifecycle, which is
 * what makes it the route where draft preview is demonstrable — the home page
 * has no Draft/Published split, so it has no pending state to show a reviewer.
 *
 * @module app/(frontend)/landing/page
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createSinglePage } from "@nextlyhq/blocks-react/next";
import { previewSingleDraftGate } from "nextly/runtime";

import {
  siteReader,
  SITE_STYLE_CONTEXT,
  SITE_STYLES,
  singleMetadata,
} from "../../../lib/site-content";

const { SinglePage, generateMetadata } = createSinglePage({
  slug: "landing-page",
  // The `blocks()` field on this single. Named rather than guessed: a wrong name
  // renders a blank page instead of raising, which is the least debuggable
  // outcome available.
  field: "hero",
  nextly: siteReader,
  // Stated even though it is this site's default language, because nothing
  // infers the default on your behalf — inferring it means reading
  // configuration at request time, and a reader may defer booting until its
  // first query. It is also what a preview token's locale is compared against.
  locale: "en",
  // Without this the route serves the PUBLISHED document only, so a preview
  // link verifies, redirects, and then shows the live page — the reviewer sees
  // no sign that what they are looking at is not the draft they were sent.
  //
  // The gate answers yes or no rather than handing back an id: a Single has
  // exactly one document, so its slug is its identity and there is no second
  // row for the route to check the answer against.
  draft: previewSingleDraftGate(),
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
