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
import { useEffect } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  SITE_CSS_DRAWN_ROUTE_PATH,
  type SiteCssDrawn,
} from "../site-css-contract";

/** The mounted canvases' reads, each asked again when the CSS is saved. */
const drawnReads = new Set<() => void>();

/**
 * Tell every canvas drawing the site's CSS that a save stored new CSS, so
 * each reads it again. The save goes through a write the admin's read cache
 * knows nothing of, so the canvas would otherwise draw the old CSS until it
 * is opened again.
 */
export function siteCssSaved(): void {
  for (const reread of drawnReads) reread();
}

/** The site's CSS as the canvas draws it, or `undefined` while there is none to draw. */
export function useDrawnSiteCss(): string | undefined {
  // The admin's own cached plugin read. Fresh on each mount, and read again
  // whenever Settings saves the CSS (`siteCssSaved`).
  const { data, refetch } = usePluginRoute<SiteCssDrawn>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_CSS_DRAWN_ROUTE_PATH,
    staleTime: 0,
  });
  useEffect(() => {
    drawnReads.add(refetch);
    return () => {
      drawnReads.delete(refetch);
    };
  }, [refetch]);
  const css = data?.css;
  return typeof css !== "string" || css.trim() === "" ? undefined : css;
}
