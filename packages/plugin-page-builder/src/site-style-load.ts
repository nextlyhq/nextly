/**
 * The site style a published route serves, read with the booted instance's
 * spacing model when the route's reader offers no plugin services.
 *
 * Server-only, and the package root's `loadSiteStyle`: the documented route
 * hands a reader of `find`, `findByID` and `findSingle` alone, so the model is
 * read from the instance this process booted. Kept apart from
 * `site-style-storage`, which browser entries reach, because the booted read
 * imports the SDK root at call time (`spacing-mode-booted`).
 *
 * @module site-style-load
 */
import type { SiteStyleData } from "./site-style";
import { loadSiteStyle as loadStoredSiteStyle } from "./site-style-storage";
import { bootedSpacingModeReader } from "./spacing-mode-booted";

/** The arguments a route hands: the storage read's, less the fallback this supplies. */
type LoadSiteStyleArgs = Omit<
  Parameters<typeof loadStoredSiteStyle>[0],
  "bootedReader"
>;

/**
 * Config defaults with the stored document layered on top, under the site's
 * recorded spacing model, ready to hand to a route helper's `siteStyles`.
 */
export function loadSiteStyle(args: LoadSiteStyleArgs): Promise<SiteStyleData> {
  return loadStoredSiteStyle({
    ...args,
    bootedReader: bootedSpacingModeReader,
  });
}
