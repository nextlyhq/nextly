/**
 * Single Blog Post Page
 *
 * Full post rendering:
 *   Reading progress bar (article-scoped)
 *   Category badge + title + meta row (author, date, reading time)
 *   Share bar (Twitter/X, LinkedIn, Copy link)
 *   Featured image
 *   Collapsible Table of Contents (auto from H2/H3 in the body)
 *   Rich-text body with id-injected headings for anchor links
 *   Share bar (repeat at bottom)
 *   AuthorCard (compact)
 *   Related posts
 *   Prev/Next navigation
 *
 * Ships Article + BreadcrumbList JSON-LD and the full Metadata API
 * (canonical, OpenGraph, Twitter card, robots index/follow).
 */

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthorCard } from "@/components/AuthorCard";
import { CategoryBadge } from "@/components/CategoryBadge";
import { TagBadge } from "@/components/TagBadge";
import { JsonLd } from "@/components/JsonLd";
import { PostGrid } from "@/components/PostGrid";
import { PostPrevNext } from "@/components/PostPrevNext";
import { PostShareBar } from "@/components/PostShareBar";
import { PostTOC } from "@/components/PostTOC";
import { ReadingProgressBar } from "@/components/ReadingProgressBar";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import { extractToc } from "@/lib/extract-toc";
import { formatPublishedDate } from "@/lib/format-date";
import {
  getAdjacentPosts,
  getAllPostSlugs,
  getPostBySlug,
  getRelatedPosts,
  getSiteSettings,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export async function generateStaticParams() {
  const slugs = await getAllPostSlugs();
  return slugs.map(slug => ({ slug }));
}

/** Revalidate each post page every 60 seconds (ISR). */
export const revalidate = 60;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  const seo = post.seo ?? {};
  const title = seo.metaTitle || post.title;
  const description = seo.metaDescription || post.excerpt || undefined;
  const seoImage = seo.ogImage?.url ?? post.featuredImage?.url ?? undefined;
  const images = seoImage ? [{ url: seoImage, alt: post.title }] : undefined;
  const canonical = seo.canonical || `/blog/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.publishedAt ?? undefined,
      authors: post.author ? [post.author.name] : undefined,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: seoImage ? [seoImage] : undefined,
    },
    robots: {
      index: !seo.noindex,
      follow: !seo.noindex,
    },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    getPostBySlug(slug),
    getSiteSettings(),
  ]);
  if (!post) notFound();

  const [relatedPosts, adjacent] = await Promise.all([
    getRelatedPosts(post.slug, {
      categorySlugs: Array.isArray(post.categories)
        ? post.categories.map(c => c.slug).filter(Boolean)
        : [],
      tagSlugs: Array.isArray(post.tags)
        ? post.tags.map(t => t.slug).filter(Boolean)
        : [],
      authorId: post.author?.id,
      limit: 3,
    }),
    getAdjacentPosts(slug, post.publishedAt),
  ]);

  // Build TOC + id-injected body from the HTML content. extractToc is
  // safe to run on trusted server-generated HTML.
  const rawHtml = typeof post.content === "string" ? post.content : "";
  const { html: bodyHtml, toc } = extractToc(rawHtml);

  const formattedDate = formatPublishedDate(post.publishedAt, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const postUrl = absoluteUrl(`/blog/${slug}`);

  // Google clamps Article.headline at 110 chars for rich results.
  const headline =
    post.title.length > 110 ? `${post.title.slice(0, 107)}…` : post.title;

  const articleImage = post.featuredImage?.url
    ? [post.featuredImage.url]
    : [absoluteUrl(`/blog/${slug}/opengraph-image`)];

  const articleSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description: post.excerpt ?? undefined,
    image: articleImage,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.publishedAt ?? undefined,
    mainEntityOfPage: postUrl,
    author: post.author
      ? {
          "@type": "Person",
          name: post.author.name,
          url: absoluteUrl(`/authors/${post.author.slug}`),
        }
      : undefined,
    publisher: {
      "@type": "Organization",
      name: settings.siteName,
    },
  };

  const breadcrumbSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: absoluteUrl("/blog"),
      },
      { "@type": "ListItem", position: 3, name: post.title, item: postUrl },
    ],
  };

  return (
    <>
      <ReadingProgressBar />

      <article className="pb-20 md:pb-32">
        <JsonLd data={[articleSchema, breadcrumbSchema]} />

        {/* Hero Header Section */}
        <header
          className="border-b pt-24 pb-20 md:pt-36 md:pb-28"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div className="mx-auto max-w-7xl px-6 text-center">
            {/* Meta Row - Top Level */}
            <div
              className="mb-8 flex flex-wrap items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-widest-premium opacity-60"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {formattedDate && (
                <time dateTime={post.publishedAt ?? undefined}>
                  {formattedDate}
                </time>
              )}
              <span className="opacity-30">/</span>
              {post.readingTime && <span>{post.readingTime} MIN READ</span>}
            </div>

            {/* Title */}
            <h1
              className="mx-auto mb-10 max-w-5xl text-4xl font-bold leading-[1.05] tracking-tightest-premium sm:text-6xl md:text-8xl"
              style={{ color: "var(--color-fg)" }}
            >
              {post.title}
            </h1>

            {/* Author info & Category */}
            <div className="flex flex-col items-center gap-8">
              {post.author && (
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-8 overflow-hidden rounded-full border border-black/10 dark:border-white/10"
                    style={{ background: "var(--color-bg)" }}
                  >
                    {post.author.avatarUrl ? (
                      <img
                        src={post.author.avatarUrl}
                        alt={post.author.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-accent/5 text-[10px] font-bold">
                        {post.author.name[0]}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/authors/${post.author.slug}`}
                    className="text-xs font-bold transition-all hover:opacity-70"
                    style={{ color: "var(--color-fg)" }}
                  >
                    {post.author.name}
                  </Link>
                </div>
              )}

              {post.categories && post.categories.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2">
                  {post.categories.map(cat => (
                    <CategoryBadge
                      key={cat.slug}
                      name={cat.name}
                      slug={cat.slug}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Featured image - Cinematic & Immersive */}
        {post.featuredImage?.url && (
          <div className="mx-auto -mt-20 max-w-6xl px-6 md:-mt-24 lg:px-8">
            <div
              className="group relative overflow-hidden rounded-none border-x border-b shadow-premium-lg"
              style={{ borderColor: "var(--color-border)" }}
            >
              {/* Subtle architectural overlay */}
              <div className="absolute inset-0 z-10 pointer-events-none border-[12px] border-transparent transition-all duration-700 group-hover:border-black/5 dark:group-hover:border-white/5" />

              <Image
                src={post.featuredImage.url}
                alt={post.featuredImage.altText || post.title}
                width={1600}
                height={900}
                sizes="(min-width: 1280px) 1400px, 100vw"
                className="aspect-[21/9] w-full object-cover transition-transform duration-1000 group-hover:scale-[1.03]"
                priority
              />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="mx-auto max-w-7xl px-6 pt-16 md:pt-24">
          <div className="flex flex-col lg:flex-row lg:gap-20">
            {/* Sidebar with TOC & Share */}
            <aside className="mb-12 lg:mb-0 lg:w-64 lg:shrink-0">
              <div className="sticky top-24 space-y-12">
                {toc.length > 0 && (
                  <div className="hidden lg:block">
                    <PostTOC toc={toc} />
                  </div>
                )}
                <div>
                  <PostShareBar title={post.title} url={postUrl} />
                </div>
              </div>
            </aside>

            {/* Article Content */}
            <div className="flex-1 lg:max-w-3xl">
              {/* Mobile TOC */}
              {toc.length > 0 && (
                <div className="mb-12 lg:hidden">
                  <PostTOC toc={toc} />
                </div>
              )}

              {bodyHtml && (
                <div className="mb-20">
                  <RichTextRenderer html={bodyHtml} className="prose-blog" />
                </div>
              )}

              {/* Tags Section */}
              {post.tags && post.tags.length > 0 && (
                <div className="mb-12">
                  <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest opacity-40">
                    Topic focus
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {post.tags.map(tag => (
                      <TagBadge
                        key={tag.slug}
                        name={tag.name}
                        slug={tag.slug}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Author card */}
              {post.author && (
                <div
                  className="border-t py-12"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <AuthorCard author={post.author} />
                </div>
              )}

              {/* Prev/Next */}
              <div
                className="border-t pt-12"
                style={{ borderColor: "var(--color-border)" }}
              >
                <PostPrevNext
                  previous={adjacent.previous}
                  next={adjacent.next}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Related posts - Full width section to match homepage */}
        {relatedPosts.length > 0 && (
          <section
            className="mt-24 border-t"
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
                  Related Perspectives
                </h2>
                <Link
                  href="/blog"
                  className="group flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-accent)" }}
                >
                  Explore more
                  <svg
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
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
              <PostGrid posts={relatedPosts} />
            </div>
          </section>
        )}
      </article>
    </>
  );
}
