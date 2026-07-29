/**
 * Site Settings single (code-first) — one global document (no list). Demonstrates
 * embedding the reusable SEO field group inside a single via the `fieldGroup()` field
 * helper; the embedded instance is stored in `comp_seo`, scoped to this single.
 */
import { defineSingle, text, textarea, fieldGroup } from "nextly/config";

export const SiteSettings = defineSingle({
  slug: "site-settings",
  label: { singular: "Site Settings" },
  // Localized: translatable fields store per language in `single_site-settings_locales`.
  localized: true,
  fields: [
    // Shared across languages (the brand name is the same in every locale) — opt out
    // of the text-field default with an explicit `localized: false`.
    text({
      name: "siteName",
      required: true,
      label: "Site Name",
      localized: false,
    }),
    // Translatable (text-like → per language).
    textarea({ name: "tagline", label: "Tagline" }),
    // Single-component embed: one SEO instance used as the site-wide default.
    fieldGroup({ name: "seo", component: "seo", label: "Default SEO" }),
  ],
});
