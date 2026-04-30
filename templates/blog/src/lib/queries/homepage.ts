/**
 * Homepage single query helper.
 *
 * Returns the homepage content (hero copy) and section visibility
 * toggles. Falls back to sensible defaults if the single hasn't been
 * populated yet.
 *
 * Cached via React's `cache()` so multiple components on the same
 * request share a single DB fetch.
 */

import { cache } from "react";

// Use project-local wrapper so getNextly() bootstraps with the
// nextly.config.ts collections list. See src/lib/nextly.ts.
import { getNextly } from "@/lib/nextly";

export interface Homepage {
  heroTitle: string;
  heroSubtitle: string;
  showFeaturedPost: boolean;
  featuredSectionTitle: string;
  showLatestPosts: boolean;
  latestSectionTitle: string;
  latestPostsCount: number;
  showCategoryStrip: boolean;
  showNewsletterCta: boolean;
  newsletterHeading: string;
  newsletterSubheading: string;
}

const DEFAULTS: Homepage = {
  heroTitle: "Ideas on building, shipping, and surviving software.",
  heroSubtitle: "Essays and notes from our engineering team.",
  showFeaturedPost: true,
  featuredSectionTitle: "Featured",
  showLatestPosts: true,
  latestSectionTitle: "Latest",
  latestPostsCount: 3,
  showCategoryStrip: true,
  showNewsletterCta: true,
  newsletterHeading: "Get new posts in your inbox",
  newsletterSubheading: "No spam. Unsubscribe anytime.",
};

export const getHomepage = cache(async (): Promise<Homepage> => {
  try {
    const nextly = await getNextly();
    const hp = await nextly.findGlobal({ slug: "homepage", depth: 0 });
    if (!hp) return DEFAULTS;
    return {
      heroTitle: (hp.heroTitle as string) || DEFAULTS.heroTitle,
      heroSubtitle: (hp.heroSubtitle as string) || DEFAULTS.heroSubtitle,
      showFeaturedPost: hp.showFeaturedPost !== false,
      featuredSectionTitle:
        (hp.featuredSectionTitle as string) || DEFAULTS.featuredSectionTitle,
      showLatestPosts: hp.showLatestPosts !== false,
      latestSectionTitle:
        (hp.latestSectionTitle as string) || DEFAULTS.latestSectionTitle,
      latestPostsCount:
        (hp.latestPostsCount as number) || DEFAULTS.latestPostsCount,
      showCategoryStrip: hp.showCategoryStrip !== false,
      showNewsletterCta: hp.showNewsletterCta !== false,
      newsletterHeading:
        (hp.newsletterHeading as string) || DEFAULTS.newsletterHeading,
      newsletterSubheading:
        (hp.newsletterSubheading as string) || DEFAULTS.newsletterSubheading,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[blog] getHomepage: falling back to defaults:",
        err instanceof Error ? err.message : err
      );
    }
    return DEFAULTS;
  }
});
