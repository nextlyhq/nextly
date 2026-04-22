/**
 * Navigation single query helper.
 *
 * Returns the header/footer link lists and the UI toggles. Falls back
 * to sensible defaults if the single hasn't been populated yet (first
 * run before seed, fresh install, or a deleted single).
 *
 * Cached via React's `cache()` so multiple components on the same
 * request share a single DB fetch.
 */

import { getNextly } from "@revnixhq/nextly";
import { cache } from "react";

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
    const nextly = await getNextly();
    const nav = await nextly.findGlobal({ slug: "navigation", depth: 0 });
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
