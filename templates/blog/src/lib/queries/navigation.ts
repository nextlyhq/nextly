/**
 * Navigation single query helper.
 *
 * Returns the header/footer link lists and the UI toggles. Falls back
 * to sensible defaults if the single hasn't been populated yet (first
 * run before seed, fresh install, or a deleted single).
 *
 * Wrapped in React's `cache()` so multiple components on the same request
 * share a single DB fetch, and in `cachedFind` so the result persists
 * across requests until an edit to the navigation single busts
 * `nextlySingleTags("navigation")`.
 */

import { cache } from "react";

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import { cachedFind, nextlySingleTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

export interface NavLink {
  label: string;
  href: string;
  openInNewTab?: boolean;
}

export interface Navigation {
  headerLinks: NavLink[];
  footerReadLinks: NavLink[];
  showThemeToggle: boolean;
  showSearchIcon: boolean;
}

const DEFAULTS: Navigation = {
  headerLinks: [
    { label: "Blog", href: "/blog" },
    { label: "Tags", href: "/tags" },
    { label: "Categories", href: "/categories" },
  ],
  footerReadLinks: [
    { label: "Latest posts", href: "/blog" },
    { label: "All tags", href: "/tags" },
    { label: "All categories", href: "/categories" },
    { label: "RSS feed", href: "/feed.xml" },
  ],
  showThemeToggle: true,
  showSearchIcon: true,
};

export const getNavigation = cache(async (): Promise<Navigation> => {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const nav = await nextly.findSingle({ slug: "navigation", depth: 0 });
        if (!nav) return DEFAULTS;
        return {
          headerLinks:
            (nav.headerLinks as NavLink[] | undefined) ?? DEFAULTS.headerLinks,
          footerReadLinks:
            (nav.footerReadLinks as NavLink[] | undefined) ??
            DEFAULTS.footerReadLinks,
          showThemeToggle: nav.showThemeToggle !== false,
          showSearchIcon: nav.showSearchIcon !== false,
        };
      },
      {
        tags: nextlySingleTags("navigation"),
        keyParts: ["single", "navigation"],
      }
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[blog] getNavigation: falling back to defaults:",
        err instanceof Error ? err.message : err
      );
    }
    return DEFAULTS;
  }
});
