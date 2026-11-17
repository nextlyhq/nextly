/**
 * The `siteHeaderFooter` option, checked where it is given: who draws the
 * site's header and footer.
 *
 * @module site-header-footer
 */

/**
 * Who draws the site's header and footer: `"page-builder"`, from the header
 * & footer sets authors build, or `"code"`, by the site's own code around its
 * page route.
 */
export type SiteHeaderFooter = "page-builder" | "code";

/** What a site that says nothing gets. */
export const DEFAULT_SITE_HEADER_FOOTER: SiteHeaderFooter = "page-builder";

/**
 * Who draws the site's header and footer, or a refusal naming the option and
 * both values.
 *
 * Checked at boot rather than trusted: a config written in JavaScript can
 * pass anything, and a typo read as the default would quietly seed and draw
 * headers on a site that draws its own.
 */
export function siteHeaderFooterOption(value: unknown): SiteHeaderFooter {
  if (value === undefined) return DEFAULT_SITE_HEADER_FOOTER;
  if (value === "page-builder" || value === "code") return value;
  throw new Error(
    `[page-builder] siteHeaderFooter must be "page-builder" or "code" (got ${JSON.stringify(value)})`
  );
}
