// Field factories come from the curated `nextly/config` field-authoring surface
// rather than the root `nextly` barrel. `FieldConfig` is a type-only import, so
// it is erased at build and adds no runtime coupling.
import type { FieldConfig } from "nextly";
import { checkbox, text, textarea, upload } from "nextly/config";

/**
 * The default fields placed INSIDE the `seo` group on each target collection
 * (the plugin wraps these in a `group({ name: "seo" })`, so entries expose them
 * at `entry.seo.metaTitle` etc.). Every field is optional.
 *
 * Ships `canonical` + `noindex` by default: a per-page canonical URL and a
 * search-engine opt-out are baseline SEO controls, and shipping them out of the
 * box is a deliberate edge over plugins that make you add them yourself.
 *
 * Override the whole set via `seoPlugin({ fields })` when a project needs a
 * different shape; overrides stay nested under `seo`.
 */
export function defaultSeoFields(): FieldConfig[] {
  return [
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
  ];
}
