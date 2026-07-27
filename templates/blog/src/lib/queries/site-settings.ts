/**
 * Site settings query helper.
 *
 * Wrapped in React's `cache()` so every Server Component on the same
 * request gets a single deduplicated fetch, and in `cachedFind` so the
 * result persists across requests until an edit to the site-settings
 * single busts `nextlySingleTags("site-settings")`. Falls back to sensible
 * defaults when the single hasn't been initialized yet (first run before
 * seed, or fresh project without the single populated); once the single is
 * created the tag bust refreshes this automatically.
 */

import { cache } from "react";

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import { cachedFind, nextlySingleTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import type { SiteSettings } from "./types";

const DEFAULTS: SiteSettings = {
  siteName: "My Blog",
  tagline: "Thoughts on web development",
  siteDescription: "A blog built with Nextly.",
  logo: null,
  social: null,
};

export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const settings = await nextly.findSingle({
          slug: "site-settings",
          depth: 1,
        });
        if (!settings) return DEFAULTS;
        return {
          siteName: (settings.siteName as string) || DEFAULTS.siteName,
          tagline: (settings.tagline as string) || DEFAULTS.tagline,
          siteDescription:
            (settings.siteDescription as string) || DEFAULTS.siteDescription,
          logo: (settings.logo as SiteSettings["logo"]) ?? null,
          social: (settings.social as SiteSettings["social"]) ?? null,
        };
      },
      {
        tags: nextlySingleTags("site-settings"),
        keyParts: ["single", "site-settings"],
      }
    );
  } catch (err) {
    // Settings single may not exist yet on first run — defaults keep
    // the pages renderable instead of crashing. Log in dev so real
    // failures (DB connection, schema mismatch) are visible.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[blog] getSiteSettings: falling back to defaults:",
        err instanceof Error ? err.message : err
      );
    }
    return DEFAULTS;
  }
});
