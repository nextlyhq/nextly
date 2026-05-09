/**
 * Per-post OG image. Overridden by `post.seo.ogImage` when the writer
 * uploads a custom one — the page's generateMetadata prefers the custom
 * image and this dynamic route becomes unused for that post.
 */

import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from "@/lib/og";
import { getPostBySlug, getSiteSettings } from "@/lib/queries";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Post cover image";

export default async function PostOG({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [settings, post] = await Promise.all([
    getSiteSettings(),
    getPostBySlug(slug),
  ]);

  return renderOg({
    variant: "post",
    siteName: settings.siteName,
    eyebrow: "Post",
    primary: post?.title ?? settings.siteName,
    secondary: post?.author ? `By ${post.author.name}` : settings.tagline,
  });
}
