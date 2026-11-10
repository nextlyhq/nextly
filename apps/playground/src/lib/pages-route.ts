/**
 * The options both routes over the page builder's `pages` share: the one at
 * the site root, which reads as the visitor and takes a preview link, and the
 * public one at `/site`, which is cached and rebuilt by its tags.
 *
 * One declaration, because the two routes draw the same documents inside the
 * same Layouts, and a page that rendered differently at one address than at
 * the other would make whichever was measured say nothing about the other.
 *
 * @module lib/pages-route
 */
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { BlocksPageConfig } from "@nextlyhq/blocks-react/next";
import {
  namedQueriesOf,
  pageBuilderLayouts,
} from "@nextlyhq/plugin-page-builder";

import { pageBuilderPlugin } from "../../nextly.config";
import { siteReader, SITE_STYLE_CONTEXT, SITE_STYLES } from "./site-content";

export const pagesRoute: BlocksPageConfig = {
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
  // An explicit set, not the process registry. `registeredBlocks()` reads the
  // engine's global registry, which is populated by whatever booted the editor
  // — so a public route depending on it renders the unknown-block placeholder
  // whenever this request arrived before the admin did.
  blocks: createBlockResolver(coreBlocks),
  // This site's named queries, a list's custom sources: the page builder's
  // own, so a list here never resolves another site's served alongside.
  namedQueries: namedQueriesOf(pageBuilderPlugin),
  // No `data`: a `core/collection-loop` reads through the route's public
  // reader, published entries and public fields only, as any visitor would.
  styleContext: SITE_STYLE_CONTEXT,
  // The one provider, shared with the single-page routes so every route
  // resolves its tokens the same way. See `SITE_STYLES`.
  siteStyles: SITE_STYLES,
  // Each page drawn inside its Layout: header, page, footer. Read through the
  // same reader as the page, so the default comes from the same instance.
  layouts: pageBuilderLayouts({ nextly: siteReader }),
  metadata: (entry, _context, derived) => ({
    title: derived.title ?? (entry.title as string | undefined),
    description: derived.description,
    // `derived.canonical` is the entry's path within its collection, already
    // rooted. The root route serves it at that path, so both routes name it:
    // the cached copy at `/site` is the same page, not a second one.
    ...(derived.canonical
      ? { alternates: { canonical: derived.canonical } }
      : {}),
    ...(derived.image
      ? { openGraph: { images: [{ url: derived.image }] } }
      : {}),
  }),
};
