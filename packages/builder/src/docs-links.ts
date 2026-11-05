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

/**
 * Where the docs explain the canvas route a site mounts to draw the canvas
 * inside its own layout: the page a fallback's Details link opens.
 */
export const CANVAS_ROUTE_DOCS_HREF: string = `${DOCS_BASE}/page-builder#draw-the-canvas-in-your-sites-layout`;

/**
 * Where the docs explain how the site's background jobs are run: the usage
 * counts are filled in by one, and on a site nothing runs them for they never
 * finish, so the counting note links here.
 */
export const BACKGROUND_JOBS_DOCS_HREF: string = `${DOCS_BASE}/jobs#running-the-queue`;
