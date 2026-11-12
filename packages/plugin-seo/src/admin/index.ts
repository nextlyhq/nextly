"use client";

/**
 * `@nextlyhq/plugin-seo/admin`: the admin's SEO screens, each registered
 * under the component path the plugin names it by: the SEO section's
 * screens (Overview, Pages with its Import and Inspect, Problems, Redirects
 * and Settings), the screens left at the section's old addresses, the SEO tab
 * on each page the plugin adds SEO to and in the Page Builder's Settings, its
 * side panel line, and the panel the tab draws, for any surface that edits a
 * page's SEO.
 *
 * The registration is what makes them render: the admin resolves a component
 * path through its registry, so a component exported but not registered
 * draws nothing. A site's generated component map imports this module.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import { BULK_PAGE } from "../bulk/contract";
import { PAGES_PAGE } from "../code-pages/contract";
import { IMPORT_PAGE, INSPECT_PAGE, OVERVIEW_PAGE } from "../overview/contract";
import { PROBLEMS_PAGE } from "../problems/contract";
import { RECEIVED_PAGE } from "../received/contract";
import { REDIRECTS_PAGE } from "../redirects/contract";
import { SETTINGS_PAGE } from "../settings/contract";
import { SEO_STATUS_COMPONENT, SEO_TAB_COMPONENT } from "../tab/contributions";
import { PAGE_BUILDER_TAB_COMPONENT } from "../template/contributions";

import { PageBuilderSeoTab } from "./PageBuilderSeoTab";
import { PAGES_STEP, SeoReceivedMoved, withTrail } from "./section";
import { SeoBulkPage as BulkScreen } from "./SeoBulkPage";
import { SeoImportPage } from "./SeoImportPage";
import { SeoOverviewPage } from "./SeoOverviewPage";
import { SeoPagesPage as PagesScreen } from "./SeoPagesPage";
import { SeoProblemsPage } from "./SeoProblemsPage";
import { SeoReceivedPage } from "./SeoReceivedPage";
import { SeoRedirectsPage as RedirectsScreen } from "./SeoRedirectsPage";
import { SeoSettingsPage } from "./SeoSettingsPage";
import { SeoTab } from "./SeoTab";
import { SeoStatusSection } from "./status";

// Each screen of the SEO section sets its trail in the top bar; the screens
// drawn before the section had one are given it here. Each is exported under
// the name its component path ends in, since a site's generated component map
// registers that export.
export const SeoPagesPage: () => JSX.Element = withTrail(PagesScreen, [
  { label: "Pages" },
]);
export const SeoRedirectsPage: () => JSX.Element = withTrail(RedirectsScreen, [
  { label: "Redirects" },
]);
/** Bulk edit, at its own address until Pages' Edit mode takes it over. */
export const SeoBulkPage: () => JSX.Element = withTrail(BulkScreen, [
  PAGES_STEP,
  { label: "Bulk edit" },
]);
/** Inspect a page: drawn, for now, by the check of what search engines received. */
export const SeoInspectPage: () => JSX.Element = withTrail(SeoReceivedPage, [
  PAGES_STEP,
  { label: "Inspect" },
]);

// Registered as the module loads, which is when the component map imports it.
registerComponents({
  [OVERVIEW_PAGE.component]: SeoOverviewPage,
  [PAGES_PAGE.component]: SeoPagesPage,
  [IMPORT_PAGE.component]: SeoImportPage,
  [INSPECT_PAGE.component]: SeoInspectPage,
  [PROBLEMS_PAGE.component]: SeoProblemsPage,
  [REDIRECTS_PAGE.component]: SeoRedirectsPage,
  [SETTINGS_PAGE.component]: SeoSettingsPage,
  [BULK_PAGE.component]: SeoBulkPage,
  // The old address of the check of what search engines received, sending
  // a bookmark on to Inspect.
  [RECEIVED_PAGE.component]: SeoReceivedMoved,
  [SEO_TAB_COMPONENT]: SeoTab,
  [PAGE_BUILDER_TAB_COMPONENT]: PageBuilderSeoTab,
  [SEO_STATUS_COMPONENT]: SeoStatusSection,
});

export { SeoOverviewPage } from "./SeoOverviewPage";
export { SeoImportPage } from "./SeoImportPage";
export { SeoProblemsPage } from "./SeoProblemsPage";
export { SeoSettingsPage } from "./SeoSettingsPage";
export { SeoReceivedMoved } from "./section";
export { SeoReceivedPage } from "./SeoReceivedPage";
export { SeoTab } from "./SeoTab";
export { PageBuilderSeoTab } from "./PageBuilderSeoTab";
export { SeoStatusSection } from "./status";
export { SeoPanel, type SeoPanelProps } from "./SeoPanel";
export {
  panelAnswers,
  SEO_PANEL_FIELDS,
  type ChosenImage,
  type PanelAnswers,
  type SeoPanelField,
  type SeoPanelValues,
} from "./values";
