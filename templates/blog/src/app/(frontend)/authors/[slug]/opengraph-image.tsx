import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from "@/lib/og";
import { getAuthorBySlug, getSiteSettings } from "@/lib/queries";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Author cover image";

export default async function AuthorOG({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [settings, author] = await Promise.all([
    getSiteSettings(),
    getAuthorBySlug(slug),
  ]);

  return renderOg({
    variant: "author",
    siteName: settings.siteName,
    eyebrow: "Author",
    primary: author?.name ?? "Author",
    secondary: author?.bio ?? undefined,
  });
}
