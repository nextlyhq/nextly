/**
 * The SEO tab in the Page Builder's Settings dialog, as the plugin adds it:
 * the one panel, for a page's own SEO and for a design's rule for every page
 * it draws. And, at the same place, what the builder shows of a page's
 * search result where it draws one (`PAGE_BUILDER_SEARCH`). Added to the
 * Page Builder's place, which exists only where the Page Builder runs; the
 * plugin names it in `optionalDependsOn`, so a site without it starts with
 * both left out.
 *
 * @module template/contributions
 */
import type { AdminContribution } from "@nextlyhq/plugin-sdk";

/** The Page Builder's Settings place, as it declares it. */
const PAGE_BUILDER_SETTINGS_PLACE = "nextlyhq-plugin-page-builder.settings";

/** The tab's component, as the admin's component map names it. */
export const PAGE_BUILDER_TAB_COMPONENT =
  "@nextlyhq/plugin-seo/admin#PageBuilderSeoTab";

/** The tab, added to the Page Builder's Settings dialog. */
export const PAGE_BUILDER_TAB: AdminContribution = {
  id: "nextlyhq-plugin-seo.page-builder-tab",
  kind: "tab",
  place: PAGE_BUILDER_SETTINGS_PLACE,
  label: "SEO",
  component: PAGE_BUILDER_TAB_COMPONENT,
};

/** The search result's component, as the admin's component map names it. */
export const PAGE_BUILDER_SEARCH_COMPONENT =
  "@nextlyhq/plugin-seo/admin#PageBuilderSearchResult";

/**
 * What the builder shows of a page's search result, in its place in the
 * Settings dialog's General and in the right panel's page settings: the
 * SEO plugin's own answer where it edits SEO for the page's type, so no
 * other preview of the page can disagree with its SEO tab, and where it
 * does not, that SEO is turned off for the type. Contributed, the Page
 * Builder's own plain preview is not drawn.
 */
export const PAGE_BUILDER_SEARCH: AdminContribution = {
  id: "nextlyhq-plugin-seo.page-builder-search",
  kind: "block",
  place: PAGE_BUILDER_SETTINGS_PLACE,
  component: PAGE_BUILDER_SEARCH_COMPONENT,
};
