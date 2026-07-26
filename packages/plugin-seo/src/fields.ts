import { checkbox, group, text, textarea, upload } from "nextly";
import type { FieldConfig } from "nextly";

/**
 * The default SEO field group contributed onto each target collection.
 *
 * Nested under a `seo` group so entries expose `entry.seo.metaTitle` etc.,
 * keeping the collection's top-level namespace clean and matching the shape
 * templates already use. Every field is optional.
 *
 * Ships `canonical` + `noindex` by default: a per-page canonical URL and a
 * search-engine opt-out are baseline SEO controls, and shipping them out of the
 * box is a deliberate edge over plugins that make you add them yourself.
 *
 * Override the whole set via `seoPlugin({ fields })` when a project needs a
 * different shape.
 */
export function defaultSeoFields(): FieldConfig[] {
  return [
    group({
      name: "seo",
      label: "SEO",
      fields: [
        text({
          name: "metaTitle",
          label: "Meta Title",
          // Search engines truncate titles past ~60 chars.
          maxLength: 60,
        }),
        textarea({
          name: "metaDescription",
          label: "Meta Description",
          // Search engines truncate descriptions past ~160 chars.
          maxLength: 160,
        }),
        upload({
          name: "ogImage",
          label: "Social Share Image",
          relationTo: "media",
        }),
        text({
          name: "canonical",
          label: "Canonical URL",
        }),
        checkbox({
          name: "noindex",
          label: "Hide from search engines",
          defaultValue: false,
        }),
      ],
    }),
  ];
}
