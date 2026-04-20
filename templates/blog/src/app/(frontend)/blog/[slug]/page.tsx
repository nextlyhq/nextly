/**
 * Single Blog Post Page
 *
 * Full post rendering with featured image, rich text, author card,
 * category badges, reading time, related posts, and SEO: complete
 * Metadata API (canonical, OpenGraph, Twitter, robots) plus JSON-LD
 * Article + BreadcrumbList schemas.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { AuthorCard } from "@/components/AuthorCard";
import { CategoryBadge } from "@/components/CategoryBadge";
import { JsonLd } from "@/components/JsonLd";
import { PostGrid } from "@/components/PostGrid";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import {
  getAllPostSlugs,
  getPostBySlug,
  getRelatedPosts,
  getSiteSettings,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Pre-render every published post at build time. Anything published
 * later gets rendered on-demand and cached per `revalidate` below.
 *
 * We deliberately chose generateStaticParams + revalidate over Next.js
 * 16 Cache Components here: the static-params pattern is mature, well-
 * documented, portable across every Nextly-supported database, and
 * easy for template users to reason about. Cache Components is newer
 * and introduces behavior that's harder to debug. Migrate whenever
 * the ecosystem settles.
 */
export async function generateStaticParams() {
  const slugs = await getAllPostSlugs();
  return slugs.map(slug => ({ slug }));
}

/** Revalidate each post page every 60 seconds (ISR). */
export const revalidate = 60;

/**
 * Posts published after the build render on-demand via ISR. Default
 * for dynamic segments; pinned explicitly so the behavior is obvious
 * to readers of the code.
 */
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

  // Image precedence: explicit SEO override → featured image → dynamic OG.
  // Returning `undefined` (not [] ) lets Next.js fall back to the
  // co-located opengraph-image.tsx route automatically.
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

  const relatedPosts = await getRelatedPosts(slug, {
    tagIds: post.tags?.map(t => t.id) ?? [],
    categoryIds: post.categories?.map(c => c.id) ?? [],
    authorId: post.author?.id,
    limit: 2,
  });

  const formattedDate = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const postUrl = absoluteUrl(`/blog/${slug}`);

  // Google clamps Article.headline display at 110 chars and will drop
  // rich-result eligibility for over-long headlines. Truncate for the
  // schema only; keep the original title on the page.
  const headline =
    post.title.length > 110 ? `${post.title.slice(0, 107)}…` : post.title;

  // Article.image is required for Top Stories carousel + AMP. Fall back
  // to the co-located dynamic OG route when the post has no featured
  // image, so every post stays rich-result eligible.
  const articleImage = post.featuredImage?.url
    ? [post.featuredImage.url]
    : [absoluteUrl(`/blog/${slug}/opengraph-image`)];

  // Article schema: tells Google this is a news/blog article for
  // rich-result eligibility. BreadcrumbList drives the breadcrumb
  // UI in Google search results.
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
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: postUrl,
      },
    ],
  };

  return (
    <article>
      <JsonLd data={[articleSchema, breadcrumbSchema]} />

      {/* Featured image */}
      {post.featuredImage?.url && (
        <div className="mb-8 overflow-hidden rounded-xl">
          <Image
            src={post.featuredImage.url}
            alt={post.featuredImage.altText || post.title}
            width={1200}
            height={630}
            // Hero spans the max-w-5xl container (1024px in Tailwind v4)
            // minus px-6 padding on each side, fluid below that breakpoint.
            sizes="(min-width: 1024px) 976px, calc(100vw - 48px)"
            className="aspect-video w-full object-cover"
            priority
          />
        </div>
      )}

      {/* Category badges */}
      {post.categories && post.categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {post.categories.map(cat => (
            <CategoryBadge key={cat.slug} name={cat.name} slug={cat.slug} />
          ))}
        </div>
      )}

      {/* Title */}
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
        {post.title}
      </h1>

      {/* Author, date, reading time meta */}
      <div className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
        {post.author && (
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            {post.author.name}
          </span>
        )}
        {post.author && formattedDate && (
          <span aria-hidden="true">&middot;</span>
        )}
        {formattedDate && (
          <time dateTime={post.publishedAt ?? undefined}>{formattedDate}</time>
        )}
        {post.readingTime && formattedDate && (
          <span aria-hidden="true">&middot;</span>
        )}
        {post.readingTime ? <span>{post.readingTime} min read</span> : null}
      </div>

      {/* Post content */}
      {typeof post.content === "string" && post.content && (
        <div className="mb-12">
          <RichTextRenderer html={post.content} />
        </div>
      )}

      {/* Author card */}
      {post.author && (
        <div className="mb-12">
          <AuthorCard author={post.author} />
        </div>
      )}

      {/* Related posts */}
      {relatedPosts.length > 0 && (
        <section className="border-t border-neutral-200 pt-12 dark:border-neutral-800">
          <h2 className="mb-8 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Related Posts
          </h2>
          <PostGrid posts={relatedPosts} />
        </section>
      )}
    </article>
  );
}
