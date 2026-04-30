/**
 * Site settings query helper.
 *
 * Wrapped in React's `cache()` so every Server Component on the same
 * request gets a single deduplicated fetch. Falls back to sensible
 * defaults when the settings single hasn't been initialized yet (first
 * run before seed, or fresh project without the single populated).
 */

import { cache } from "react";

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "@revnixhq/nextly";
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
    const nextly = await getNextly({ config: nextlyConfig });
    const settings = await nextly.findGlobal({
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
