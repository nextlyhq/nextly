"use client";

/**
 * What the editor lends the inspector for a block's own custom CSS: the page
 * builder's one checker, for a person who may change the site's settings,
 * the permission site code is held to.
 *
 * The answer is the site settings read's own, `mayManageSite`. Until it has
 * answered yes, the read still pending or failed among them, nothing is
 * lent: the inspector then draws no Custom CSS section and never shows the
 * CSS, so it is never shown on a guess. The server judges every write again.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/block-custom-css
 */
import type { BlockCustomCssAccess } from "@nextlyhq/builder";
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import {
  checkCustomCss,
  customCssProblemText,
} from "../../site-code/css-check";

/**
 * The checker as the inspector calls it: each refused line in the words the
 * site's other CSS boxes use ("Line 3: …"). One value, so a person's answer
 * arriving again lends the same access.
 */
const BLOCK_CUSTOM_CSS: BlockCustomCssAccess = {
  check: css => checkCustomCss(css, "block").map(customCssProblemText),
};

/** The access to lend, or `undefined` unless the read says yes. */
export function useBlockCustomCss(): BlockCustomCssAccess | undefined {
  const read = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
  });
  return read.data?.mayManageSite === true ? BLOCK_CUSTOM_CSS : undefined;
}
