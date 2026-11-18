/**
 * The canvas's read of the site's own CSS, drawn before the page's as on the
 * live page.
 *
 * Through the plugin's drawn read, which answers anyone who may read the site
 * style, so an author who may edit a page but not the site's settings still
 * sees the CSS the page is drawn with. Until it answers, and where it fails,
 * the canvas draws the page without it: the site's CSS is a refinement of
 * the page, never a reason to hold the canvas back.
 *
 * @module admin/site-css-read
 * @experimental
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_CSS_DRAWN_ROUTE_PATH,
  type SiteCssDrawn,
} from "../library-contract";

/** The site's CSS as the canvas draws it, or `undefined` while there is none to draw. */
export function useDrawnSiteCss(): string | undefined {
  // The admin's own cached plugin read. Fresh on each mount: the CSS is
  // saved in Settings, which this read's cache knows nothing of.
  const { data } = usePluginRoute<SiteCssDrawn>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_CSS_DRAWN_ROUTE_PATH,
    staleTime: 0,
  });
  const css = data?.css;
  return typeof css !== "string" || css.trim() === "" ? undefined : css;
}
