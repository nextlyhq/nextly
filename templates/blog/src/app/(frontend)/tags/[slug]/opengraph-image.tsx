import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from "@/lib/og";
import { getSiteSettings, getTagBySlug } from "@/lib/queries";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Tag cover image";

export default async function TagOG({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [settings, tag] = await Promise.all([
    getSiteSettings(),
    getTagBySlug(slug),
  ]);

  return renderOg({
    variant: "tag",
    siteName: settings.siteName,
    eyebrow: `#${tag?.slug ?? "tag"}`,
    primary: tag?.name ?? "Tag",
    secondary: tag?.description ?? undefined,
  });
}
