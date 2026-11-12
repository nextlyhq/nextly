"use client";

/**
 * `@nextlyhq/plugin-seo/admin`: the admin's SEO screens, each registered
 * under the component path the plugin names it by: the settings and redirects
 * pages, the SEO tab on each page the plugin adds SEO to and in the Page
 * Builder's Settings, its side panel line,
 * and the panel the tab draws, for any surface that edits a page's SEO, the
 * problem list, the "What search engines received" page, and the Pages and
 * addresses screen.
 *
 * The registration is what makes them render: the admin resolves a component
 * path through its registry, so a component exported but not registered
 * draws nothing. A site's generated component map imports this module.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { BULK_PAGE } from "../bulk/contract";
import { PAGES_PAGE } from "../code-pages/contract";
import { PROBLEMS_PAGE } from "../problems/contract";
import { RECEIVED_PAGE } from "../received/contract";
import { REDIRECTS_PAGE } from "../redirects/contract";
import { SETTINGS_PAGE } from "../settings/contract";
import { SEO_STATUS_COMPONENT, SEO_TAB_COMPONENT } from "../tab/contributions";
import { PAGE_BUILDER_TAB_COMPONENT } from "../template/contributions";

import { PageBuilderSeoTab } from "./PageBuilderSeoTab";
import { SeoBulkPage } from "./SeoBulkPage";
import { SeoPagesPage } from "./SeoPagesPage";
import { SeoProblemsPage } from "./SeoProblemsPage";
import { SeoReceivedPage } from "./SeoReceivedPage";
import { SeoRedirectsPage } from "./SeoRedirectsPage";
import { SeoSettingsPage } from "./SeoSettingsPage";
import { SeoTab } from "./SeoTab";
import { SeoStatusSection } from "./status";

// Registered as the module loads, which is when the component map imports it.
registerComponents({
  [SETTINGS_PAGE.component]: SeoSettingsPage,
  [RECEIVED_PAGE.component]: SeoReceivedPage,
  [REDIRECTS_PAGE.component]: SeoRedirectsPage,
  [SEO_TAB_COMPONENT]: SeoTab,
  [PAGE_BUILDER_TAB_COMPONENT]: PageBuilderSeoTab,
  [SEO_STATUS_COMPONENT]: SeoStatusSection,
  [PROBLEMS_PAGE.component]: SeoProblemsPage,
  [BULK_PAGE.component]: SeoBulkPage,
  [PAGES_PAGE.component]: SeoPagesPage,
});

export { SeoBulkPage } from "./SeoBulkPage";
export { SeoProblemsPage } from "./SeoProblemsPage";
export { SeoReceivedPage } from "./SeoReceivedPage";
export { SeoPagesPage } from "./SeoPagesPage";
export { SeoRedirectsPage } from "./SeoRedirectsPage";
export { SeoSettingsPage } from "./SeoSettingsPage";
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
