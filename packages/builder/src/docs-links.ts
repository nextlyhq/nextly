/**
 * Where the Page Builder's documentation is published.
 *
 * One base, used in development too: the docs are a public site rather than
 * something a local app serves, so a link that worked only in production would
 * send a contributor checking it somewhere else.
 *
 * @module docs-links
 */

/** The published documentation site. */
const DOCS_BASE = "https://nextlyhq.com/docs";

/** A documentation page Help links to. */
export interface DocsLink {
  readonly label: string;
  readonly href: string;
}

/** The Page Builder's pages, in the order Help offers them. */
export const PAGE_BUILDER_DOCS: readonly DocsLink[] = [
  { label: "Page Builder docs", href: `${DOCS_BASE}/page-builder` },
  { label: "Using the editor", href: `${DOCS_BASE}/page-builder/editor` },
];
