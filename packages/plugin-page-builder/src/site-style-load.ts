/**
 * The site style a published route serves: the package root's
 * `loadSiteStyle`, the stored document layered over the code's defaults.
 *
 * Its own module, apart from `site-style-storage`, because it is the
 * server-only entry the published render loads through; browser entries
 * reach `site-style-storage` directly.
 *
 * @module site-style-load
 */
import type { SiteStyleData } from "./site-style";
import { loadSiteStyle as loadStoredSiteStyle } from "./site-style-storage";

/**
 * Config defaults with the stored document layered on top, ready to hand to a
 * route helper's `siteStyles`.
 */
export function loadSiteStyle(
  args: Parameters<typeof loadStoredSiteStyle>[0]
): Promise<SiteStyleData> {
  return loadStoredSiteStyle(args);
}
