/**
 * The page builder's custom CSS for a pages route.
 *
 * A route draws author-written CSS only through a host's checker (see
 * `CustomCssSource` in `@nextlyhq/blocks-react/next`). This is the page
 * builder's: its one checker, which the CSS boxes and the server also use.
 *
 * ```ts
 * createBlocksPage({
 *   collections: ["pages"],
 *   field: "content",
 *   customCss: pageBuilderCustomCss(),
 * });
 * ```
 *
 * A route without it draws no custom CSS at any level, so a site adds this
 * line to its pages route to show the CSS its authors write.
 *
 * @module custom-css
 * @experimental
 */
import type { CustomCssSource } from "@nextlyhq/blocks-react/next";

import { checkCustomCss, CUSTOM_CSS_CHECKER_ID } from "./site-code/css-check";
import { SITE_CODE_SLUG } from "./site-code/storage";

/**
 * The custom CSS source a pages route takes as `customCss`: the page's and
 * each block's CSS, judged by the page builder's one checker. It reads no
 * site-wide CSS.
 *
 * @experimental
 */
export function pageBuilderCustomCss(): CustomCssSource {
  return {
    id: CUSTOM_CSS_CHECKER_ID,
    accepts: (css, level) => checkCustomCss(css, level).length === 0,
    readSite: () => undefined,
    // The site's code settings: a save there is what changes the CSS the
    // site's pages draw, so a cached page carries its tag.
    singles: [SITE_CODE_SLUG],
  };
}
