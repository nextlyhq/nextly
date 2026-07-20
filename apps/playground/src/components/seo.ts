/**
 * SEO component (code-first) — a reusable field group stored in its own `comp_seo`
 * table. Defined once here, then embedded into collections/singles via the
 * `component({ component: "seo" })` field helper (see the Site Settings single).
 *
 * Components are schemas, not documents: each embed creates a row scoped to its
 * parent entry. `id`, and the component system columns (`_parent_*`, `_order`)
 * are auto-injected — never declare them.
 */
import { defineComponent, text, textarea, upload } from "nextly/config";

export const Seo = defineComponent({
  slug: "seo",
  label: { singular: "SEO Metadata" },
  // Localized: text-like fields (metaTitle, metaDescription) translate per language;
  // the upload stays shared. Text fields localize by default under a localized parent.
  localized: true,
  admin: {
    // Components with the same category are grouped together in the picker.
    category: "Shared",
    description: "Search-engine and social-share metadata.",
  },
  fields: [
    text({ name: "metaTitle", label: "Meta Title" }),
    textarea({ name: "metaDescription", label: "Meta Description" }),
    // Open Graph / social preview image, drawn from the Media library. Shared across
    // languages (not text-like → not localized by default).
    upload({ name: "ogImage", relationTo: "media", label: "OG Image" }),
  ],
});
