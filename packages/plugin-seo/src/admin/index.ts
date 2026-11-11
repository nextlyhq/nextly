"use client";

/**
 * `@nextlyhq/plugin-seo/admin`: the admin's SEO screens, each registered
 * under the component path the plugin names it by: the settings page, the
 * SEO tab on each page the plugin adds SEO to, its side panel line, and the
 * panel the tab draws, for any surface that edits a page's SEO.
 *
 * The registration is what makes them render: the admin resolves a component
 * path through its registry, so a component exported but not registered
 * draws nothing. A site's generated component map imports this module.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { SETTINGS_PAGE } from "../settings/contract";
import { SEO_STATUS_COMPONENT, SEO_TAB_COMPONENT } from "../tab/contributions";

import { SeoSettingsPage } from "./SeoSettingsPage";
import { SeoTab } from "./SeoTab";
import { SeoStatusSection } from "./status";

// Registered as the module loads, which is when the component map imports it.
registerComponents({
  [SETTINGS_PAGE.component]: SeoSettingsPage,
  [SEO_TAB_COMPONENT]: SeoTab,
  [SEO_STATUS_COMPONENT]: SeoStatusSection,
});

export { SeoSettingsPage } from "./SeoSettingsPage";
export { SeoTab } from "./SeoTab";
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
