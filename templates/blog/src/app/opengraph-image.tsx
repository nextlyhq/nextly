/**
 * Site-default OG image. Used for the homepage and as the fallback
 * when a more specific route doesn't provide its own.
 */

import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from "@/lib/og";
import { getSiteSettings } from "@/lib/queries";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Site cover image";

export default async function SiteOG() {
  const settings = await getSiteSettings();
  return renderOg({
    variant: "site",
    siteName: settings.siteName,
    primary: settings.siteName,
    secondary: settings.tagline,
  });
}
