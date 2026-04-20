/**
 * Blog Homepage
 *
 * Hero section with site name + tagline, followed by the latest 3 posts.
 * Ships WebSite JSON-LD and full metadata for the root URL.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { PostGrid } from "@/components/PostGrid";
import { getLatestPosts, getSiteSettings } from "@/lib/queries";
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
  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    getLatestPosts(3),
  ]);

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

      {/* Hero section */}
      <section className="mb-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
          {settings.siteName}
        </h1>
        <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
          {settings.tagline}
        </p>
      </section>

      {/* Latest posts section */}
      <section>
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Latest Posts
          </h2>
          <Link
            href="/blog"
            className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            View all &rarr;
          </Link>
        </div>

        <PostGrid posts={posts} />
      </section>
    </>
  );
}
