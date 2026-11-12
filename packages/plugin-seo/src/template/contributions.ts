/**
 * The SEO tab in the Page Builder's Settings dialog, as the plugin adds it:
 * the one panel, for a page's own SEO and for a design's rule for every page
 * it draws. Added to the Page Builder's place, which exists only where the
 * Page Builder runs; the plugin names it in `optionalDependsOn`, so a site
 * without it starts with the tab left out.
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

/**
 * What the Page Builder hands a tab at its place, as it declares it. Restated
 * rather than imported, so this plugin never depends on the Page Builder's
 * package.
 */
interface PageBuilderSettingsContext {
  userId: string;
  document: "page" | "template";
  collection: string;
  entryId: string | null;
  draws: { collection: string; entryId: string | null } | null;
}

declare module "@nextlyhq/plugin-sdk" {
  interface AdminPlaces {
    "nextlyhq-plugin-page-builder.settings": {
      context: PageBuilderSettingsContext;
    };
  }
}
