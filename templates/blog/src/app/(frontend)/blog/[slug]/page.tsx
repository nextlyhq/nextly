/**
 * Single Blog Post Page
 *
 * Full post rendering with the Task 17 post-detail treatment:
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
import { JsonLd } from "@/components/JsonLd";
import { PostGrid } from "@/components/PostGrid";
import { PostPrevNext } from "@/components/PostPrevNext";
import { PostShareBar } from "@/components/PostShareBar";
import { PostTOC } from "@/components/PostTOC";
import { ReadingProgressBar } from "@/components/ReadingProgressBar";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import { extractToc } from "@/lib/extract-toc";
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
    getRelatedPosts(slug, {
      tagIds: post.tags?.map(t => t.id) ?? [],
      categoryIds: post.categories?.map(c => c.id) ?? [],
      authorId: post.author?.id,
      limit: 3,
    }),
    getAdjacentPosts(slug, post.publishedAt),
  ]);

  // Build TOC + id-injected body from the HTML content. extractToc is
  // safe to run on trusted server-generated HTML.
  const rawHtml = typeof post.content === "string" ? post.content : "";
  const { html: bodyHtml, toc } = extractToc(rawHtml);

  const formattedDate = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

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

      <article className="mx-auto max-w-3xl">
        <JsonLd data={[articleSchema, breadcrumbSchema]} />

        {/* Category badges */}
        {post.categories && post.categories.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {post.categories.map(cat => (
              <CategoryBadge key={cat.slug} name={cat.name} slug={cat.slug} />
            ))}
          </div>
        )}

        {/* Title */}
        <h1
          className="mb-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
          style={{ color: "var(--color-fg)" }}
        >
          {post.title}
        </h1>

        {/* Meta row */}
        <div
          className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          style={{ color: "var(--color-fg-muted)" }}
        >
          {post.author && (
            <Link
              href={`/authors/${post.author.slug}`}
              className="font-medium transition-colors"
              style={{ color: "var(--color-fg)" }}
            >
              {post.author.name}
            </Link>
          )}
          {post.author && formattedDate && <span aria-hidden="true">·</span>}
          {formattedDate && (
            <time dateTime={post.publishedAt ?? undefined}>
              {formattedDate}
            </time>
          )}
          {post.readingTime && formattedDate && (
            <span aria-hidden="true">·</span>
          )}
          {post.readingTime ? <span>{post.readingTime} min read</span> : null}
        </div>

        {/* Share bar (top) */}
        <div className="mb-8">
          <PostShareBar title={post.title} url={postUrl} />
        </div>

        {/* Featured image */}
        {post.featuredImage?.url && (
          <div className="mb-8 overflow-hidden rounded-xl">
            <Image
              src={post.featuredImage.url}
              alt={post.featuredImage.altText || post.title}
              width={1200}
              height={630}
              sizes="(min-width: 768px) 768px, calc(100vw - 48px)"
              className="aspect-video w-full object-cover"
              priority
            />
          </div>
        )}

        {/* Table of contents */}
        {toc.length > 0 && <PostTOC toc={toc} />}

        {/* Post content */}
        {bodyHtml && (
          <div className="mb-12">
            <RichTextRenderer html={bodyHtml} className="prose-blog" />
          </div>
        )}

        {/* Share bar (bottom) */}
        <div
          className="mb-10 border-t pt-6"
          style={{ borderColor: "var(--color-border)" }}
        >
          <PostShareBar title={post.title} url={postUrl} />
        </div>

        {/* Author card */}
        {post.author && (
          <div className="mb-12">
            <AuthorCard author={post.author} />
          </div>
        )}

        {/* Related posts */}
        {relatedPosts.length > 0 && (
          <section
            className="border-t pt-12"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2
              className="mb-8 text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-fg-muted)" }}
            >
              Related reading
            </h2>
            <PostGrid posts={relatedPosts} />
          </section>
        )}

        {/* Prev/Next */}
        <PostPrevNext previous={adjacent.previous} next={adjacent.next} />
      </article>
    </>
  );
}
