/**
 * `@nextlyhq/blocks-react/next` — the Next.js-coupled surface.
 *
 * Separate from the package root so importing the renderer never pulls
 * `next/*` into a consumer's module graph. Everything that touches Next
 * (routing, metadata, draft mode) belongs here and nowhere else.
 *
 * This subpath is also where the CMS may be imported. The root entry renders a
 * document with nothing behind it; turning documents into ROUTES means
 * resolving a path to an entry, and resolving media and links means reading
 * records — both the CMS's job. Confining that here is what lets the root stay
 * usable in an app that has no Nextly at all.
 *
 * This file is the entry, and it re-exports the public names. The work lives
 * in one `next-*` module per stage:
 *
 * - `next-page-config`: what a route is configured with;
 * - `next-readers`: which instance a route reads through, and its readers;
 * - `next-entry-paths`: the paths a route serves and links to;
 * - `next-documents`: the documents, components and Layout regions drawn;
 * - `next-media`: how a render reads its images;
 * - `next-seo`: the SEO a page's own blocks derive;
 * - `next-read-sources`: the reads a page's stages make under its budget;
 * - `next-named-queries`: how a page's lists run their named queries;
 * - `next-layouts`: which Layout regions a page is drawn inside;
 * - `next-blocks-route`: the blocks page's route config;
 * - `next-content-route`: the site's one content route;
 * - `next-page-factories`: the public route factories.
 *
 * @module next
 */
import { DEFAULT_MAX_QUERIES } from "./context";

// The default stays published here too, where a route's `maxQueries` is set.
export { DEFAULT_MAX_QUERIES };

/**
 * Marker for the subpath's existence and its build wiring.
 *
 * A real export rather than an empty file: an entry that exports nothing is
 * dropped by treeshaking, so the subpath would build to nothing and its
 * `exports` map would point at a missing file — a packaging error that only
 * surfaces for a consumer after publish.
 */
export const BLOCKS_REACT_NEXT_ENTRY = "@nextlyhq/blocks-react/next";

export type {
  SiteStylesInput,
  SiteStylesProvider,
  BlocksPageConfig,
  DerivedPageSeo,
  BlocksSinglePageConfig,
  ContentAddressHolder,
  ContentTemplate,
  ContentPageConfig,
} from "./next-page-config";
export type { BlocksLayoutsProvider } from "./next-layouts";
export type { BindingSourcesArgs } from "./next-read-sources";
export { readBindingSources } from "./next-read-sources";
export {
  createSinglePage,
  createPublicSinglePage,
  createBlocksPage,
  createPublicBlocksPage,
  createContentPage,
  createPublicContentPage,
} from "./next-page-factories";
export { designMetadataFor } from "./next-content-route";

/**
 * `BlockSeoContribution` and `BlockSeoImage` are NOT re-exported here even
 * though `DerivedPageSeo` extends the first and this entry's SEO derivation is
 * their only consumer.
 *
 * They are exported from the package root instead, which resolves without the
 * `next` and `nextly` peers this entry's declarations import. A caller of
 * `createBlocksPage` can always reach the root; a block author on a standalone
 * install could not reach this entry, and two import paths for one type costs
 * more than the one path both audiences already have.
 */
