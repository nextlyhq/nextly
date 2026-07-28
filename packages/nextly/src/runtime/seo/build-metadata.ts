/**
 * `buildMetadata` — turn a content entry's `seo` field group into a Next.js
 * `Metadata` object, so an app's `generateMetadata` is one call instead of a
 * hand-mapped block per page.
 *
 * The `next` import is TYPE-ONLY, so importing this never forces `next` onto a
 * consumer at runtime — the function returns a plain object typed as `Metadata`.
 * It reads the field group `@nextlyhq/plugin-seo` contributes (`metaTitle`,
 * `metaDescription`, `ogImage`, `canonical`, `noindex`) and is defensive: a
 * missing group or blank field falls back to the value you pass in `options`.
 *
 * @module runtime/seo/build-metadata
 */
import type { Metadata } from "next";

/** The `seo` field group shape this bridge reads (all fields optional). */
export interface SeoMetaInput {
  metaTitle?: string | null;
  metaDescription?: string | null;
  /** Populated upload relation (`{ url }`) or an unresolved id — read defensively. */
  ogImage?: unknown;
  canonical?: string | null;
  noindex?: boolean | null;
}

/** An entry carrying the plugin's `seo` group (plus whatever else it has). */
export interface MetadataEntry {
  seo?: SeoMetaInput | null;
}

/** Options for {@link buildMetadata}. */
export interface BuildMetadataOptions {
  /**
   * Fallbacks used when the matching `seo` field is blank — e.g. the entry's
   * own title, excerpt, featured image, and route path.
   */
  fallback?: {
    title?: string;
    description?: string;
    image?: string;
    canonical?: string;
  };
  /**
   * Extra OpenGraph fields merged on top of the derived ones — for page-type
   * specifics the SEO group does not carry (e.g. `type: "article"`,
   * `publishedTime`, `authors`).
   */
  openGraph?: Metadata["openGraph"];
  /** Extra Twitter-card fields merged on top of the derived ones. */
  twitter?: Metadata["twitter"];
  /**
   * hreflang alternates (locale → absolute or relative URL) for a localized
   * page, mapped to `alternates.languages`.
   */
  languages?: Record<string, string>;
}

/** True for a plain, indexable object (not null, not an array-hostile value). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The first non-blank string among the candidates, or undefined. */
function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Read a URL from a populated upload relation (`{ url }`); undefined otherwise. */
function imageUrl(ogImage: unknown): string | undefined {
  if (isRecord(ogImage) && typeof ogImage.url === "string") return ogImage.url;
  return undefined;
}

/**
 * A usable `<link rel="canonical">` value: a root-relative path (resolved
 * against `metadataBase`) or an absolute http(s) URL. `canonical` is a free-text
 * field, so a non-web value like `mailto:` / `javascript:` must not become the
 * canonical URL.
 */
function isUsableCanonical(value: string): boolean {
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The first non-blank, usable canonical among the candidates (trimmed), or undefined. */
function firstUsableCanonical(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed !== "" && isUsableCanonical(trimmed)) return trimmed;
  }
  return undefined;
}

/**
 * Map an entry's `seo` group to a Next.js `Metadata` object.
 *
 * @example
 * ```ts
 * export async function generateMetadata({ params }) {
 *   const { slug } = await params;
 *   const post = await getPostBySlug(slug);
 *   if (!post) return {};
 *   return buildMetadata(post, {
 *     fallback: { title: post.title, description: post.excerpt, canonical: `/blog/${slug}` },
 *     openGraph: { type: "article", publishedTime: post.publishedAt ?? undefined },
 *   });
 * }
 * ```
 */
export function buildMetadata(
  entry: MetadataEntry,
  options: BuildMetadataOptions = {}
): Metadata {
  const seo = entry.seo ?? {};
  const fallback = options.fallback ?? {};

  const title = firstNonBlank(seo.metaTitle, fallback.title);
  const description = firstNonBlank(seo.metaDescription, fallback.description);
  const image = firstNonBlank(imageUrl(seo.ogImage), fallback.image);
  const canonical = firstUsableCanonical(seo.canonical, fallback.canonical);
  // A page is indexable unless it explicitly opts out.
  const noindex = seo.noindex === true;

  const metadata: Metadata = {};
  if (title !== undefined) metadata.title = title;
  if (description !== undefined) metadata.description = description;

  const languages = options.languages;
  const hasLanguages =
    languages !== undefined && Object.keys(languages).length > 0;
  if (canonical !== undefined || hasLanguages) {
    metadata.alternates = {
      ...(canonical !== undefined ? { canonical } : {}),
      ...(hasLanguages ? { languages } : {}),
    };
  }

  // OpenGraph — caller extras win, so a page can set `type`/`publishedTime` etc.
  const openGraph: NonNullable<Metadata["openGraph"]> = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(canonical !== undefined ? { url: canonical } : {}),
    ...(image !== undefined ? { images: [{ url: image }] } : {}),
    ...options.openGraph,
  };
  if (Object.keys(openGraph).length > 0) metadata.openGraph = openGraph;

  // Twitter — a large-image card whenever there is an image; caller extras win.
  const twitter: NonNullable<Metadata["twitter"]> = {
    ...(image !== undefined ? { card: "summary_large_image" } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(image !== undefined ? { images: [image] } : {}),
    ...options.twitter,
  };
  if (Object.keys(twitter).length > 0) metadata.twitter = twitter;

  metadata.robots = { index: !noindex, follow: !noindex };

  return metadata;
}
