/**
 * SiteSettings single: global configuration for the blog site.
 *
 * Used by Header, Footer, and SEO metadata to display the site name,
 * tagline, logo, and public social handles.
 */
import {
  defineSingle,
  text,
  textarea,
  upload,
  group,
} from "@revnixhq/nextly/config";

export const SiteSettings = defineSingle({
  slug: "site-settings",
  label: { singular: "Site Settings" },
  fields: [
    text({ name: "siteName", required: true }),
    text({ name: "tagline" }),
    textarea({ name: "siteDescription" }),
    upload({ name: "logo", relationTo: "media" }),
    group({
      name: "social",
      fields: [
        text({ name: "twitter" }),
        text({ name: "github" }),
        text({ name: "linkedin" }),
      ],
    }),
  ],
});
