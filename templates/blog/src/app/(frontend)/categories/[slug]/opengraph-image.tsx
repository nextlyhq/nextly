import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from "@/lib/og";
import { getCategoryBySlug, getSiteSettings } from "@/lib/queries";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Category cover image";

export default async function CategoryOG({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [settings, category] = await Promise.all([
    getSiteSettings(),
    getCategoryBySlug(slug),
  ]);

  return renderOg({
    variant: "category",
    siteName: settings.siteName,
    eyebrow: "Category",
    primary: category?.name ?? "Category",
    secondary: category?.description ?? undefined,
  });
}
