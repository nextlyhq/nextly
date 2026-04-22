/**
 * Blog Homepage
 *
 * Full editorial layout driven by the Homepage single:
 *   Hero → Featured post → Latest grid → Category strip → Newsletter CTA
 *
 * Every major section is independently toggleable from the admin
 * (showFeaturedPost / showLatestPosts / showCategoryStrip /
 * showNewsletterCta). Copy for the hero and newsletter comes from the
 * single too; defaults in `src/lib/queries/homepage.ts` kick in when
 * the single hasn't been populated yet.
 *
 * Ships WebSite JSON-LD and full metadata for the root URL.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { CategoryStrip } from "@/components/CategoryStrip";
import { FeaturedPost } from "@/components/FeaturedPost";
import { Hero } from "@/components/Hero";
import { JsonLd } from "@/components/JsonLd";
import { NewsletterCta } from "@/components/NewsletterCta";
import { PostGrid } from "@/components/PostGrid";
import { getAllCategories } from "@/lib/queries/categories";
import { getHomepage } from "@/lib/queries/homepage";
import { getFeaturedPost, getLatestPosts } from "@/lib/queries/posts";
import { getSiteSettings } from "@/lib/queries/site-settings";
import { absoluteUrl } from "@/lib/site-url";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: settings.siteName,
    description: settings.siteDescription,
    alternates: { canonical: "/" },
    openGraph: {
      title: settings.siteName,
      description: settings.siteDescription,
      type: "website",
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: settings.siteName,
      description: settings.siteDescription,
    },
  };
}

export default async function HomePage() {
  const [settings, homepage] = await Promise.all([
    getSiteSettings(),
    getHomepage(),
  ]);

  // Fetch only the sections we'll actually render, so toggled-off
  // sections don't incur database work.
  const [featured, latest, categories] = await Promise.all([
    homepage.showFeaturedPost ? getFeaturedPost() : Promise.resolve(null),
    homepage.showLatestPosts
      ? getLatestPosts(homepage.latestPostsCount ?? 3)
      : Promise.resolve([]),
    homepage.showCategoryStrip ? getAllCategories() : Promise.resolve([]),
  ]);

  // Filter featured out of "latest" to avoid duplicating it in both
  // sections (a common editorial mistake).
  const latestFiltered = featured
    ? latest.filter(p => p.slug !== featured.slug)
    : latest;

  const websiteSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.siteName,
    description: settings.siteDescription,
    url: absoluteUrl("/"),
  };

  return (
    <>
      <JsonLd data={websiteSchema} />

      <Hero title={homepage.heroTitle} subtitle={homepage.heroSubtitle} />

      {homepage.showFeaturedPost && featured && (
        <FeaturedPost
          post={featured}
          sectionTitle={homepage.featuredSectionTitle}
        />
      )}

      {homepage.showLatestPosts && latestFiltered.length > 0 && (
        <section className="mb-16">
          <div className="mb-6 flex items-baseline justify-between">
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {homepage.latestSectionTitle}
            </h2>
            <Link
              href="/blog"
              className="text-sm font-medium transition-colors"
              style={{ color: "var(--color-accent)" }}
            >
              View all →
            </Link>
          </div>
          <PostGrid posts={latestFiltered} />
        </section>
      )}

      {homepage.showCategoryStrip && <CategoryStrip categories={categories} />}

      {homepage.showNewsletterCta && (
        <NewsletterCta
          variant="homepage"
          heading={homepage.newsletterHeading}
          subheading={homepage.newsletterSubheading}
        />
      )}
    </>
  );
}
