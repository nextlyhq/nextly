/**
 * `@nextlyhq/plugin-seo/admin`: the SEO tab, and the panel it draws, for the
 * admin. A site's generated component map imports the tab from here by the
 * path the plugin declares (`@nextlyhq/plugin-seo/admin#SeoTab`); importing
 * this module also registers it, for an admin that registers components by
 * hand.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { SEO_STATUS_COMPONENT, SEO_TAB_COMPONENT } from "../tab/contributions";

import { SeoTab } from "./SeoTab";
import { SeoStatusSection } from "./status";

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

registerComponents({
  [SEO_TAB_COMPONENT]: SeoTab,
  [SEO_STATUS_COMPONENT]: SeoStatusSection,
});
