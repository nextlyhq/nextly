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
    homepage.showLatestPosts ? getLatestPosts(10) : Promise.resolve([]),
    homepage.showCategoryStrip ? getAllCategories() : Promise.resolve([]),
  ]);

  // Filter featured out of "latest" to avoid duplicating it in both
  // sections (a common editorial mistake).
  const latestFiltered = featured
    ? latest.filter(p => p.slug !== featured.slug).slice(0, 3)
    : latest.slice(0, 3);

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
        <section
          className="w-full border-b"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
            <div className="mb-12 flex items-center justify-between">
              <h2
                className="text-3xl font-bold tracking-tight"
                style={{ color: "var(--color-fg)" }}
              >
                {homepage.latestSectionTitle}
              </h2>
              <Link
                href="/blog"
                className="group flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-70"
                style={{ color: "var(--color-accent)" }}
              >
                View all
                <svg
                  className="w-4 h-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  ></path>
                </svg>
              </Link>
            </div>
            <PostGrid posts={latestFiltered} />
          </div>
        </section>
      )}

      {homepage.showCategoryStrip && (
        <section className="mb-24">
          <CategoryStrip categories={categories} />
        </section>
      )}

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
