/**
 * The page builder's custom CSS for a pages route.
 *
 * A route draws author-written CSS only through a host's checker (see
 * `CustomCssSource` in `@nextlyhq/blocks-react/next`). This is the page
 * builder's: its one checker, which the CSS boxes and the server also use, and
 * a read of the site's own CSS, kept with the site's code.
 *
 * ```ts
 * createBlocksPage({
 *   collections: ["pages"],
 *   field: "content",
 *   customCss: pageBuilderCustomCss({ nextly: siteReader }),
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
import type { Nextly } from "nextly";

import { checkCustomCss, CUSTOM_CSS_CHECKER_ID } from "./site-code/css-check";
import { SITE_CODE_SLUG } from "./site-code/storage";

/** What the source reads through. */
export interface PageBuilderCustomCssOptions {
  /**
   * The instance to read through, for a route reading through one of its own.
   * Defaults to the process's Nextly, resolved per read.
   */
  readonly nextly?: Pick<Nextly, "findSingle">;
}

/**
 * The custom CSS source a pages route takes as `customCss`.
 *
 * @experimental
 */
export function pageBuilderCustomCss(
  options: PageBuilderCustomCssOptions = {}
): CustomCssSource {
  return {
    id: CUSTOM_CSS_CHECKER_ID,
    accepts: (css, level) => checkCustomCss(css, level).length === 0,
    readSite: async () => {
      // Resolved per read rather than captured, for the reason the layouts
      // provider gives: a route module is loaded before Nextly has booted.
      const nextly =
        options.nextly ??
        (await (await import("@nextlyhq/plugin-sdk")).getCachedNextly());
      const doc: Record<string, unknown> | null = await nextly.findSingle({
        slug: SITE_CODE_SLUG,
        depth: 0,
        overrideAccess: true,
        createIfMissing: false,
        // Both identity channels cleared, as every system read a published
        // page makes clears them: the render is cached for every visitor.
        user: undefined,
        req: undefined,
      });
      const css = doc?.css;
      return typeof css === "string" && css.trim() !== "" ? css : undefined;
    },
    singles: [SITE_CODE_SLUG],
  };
}
