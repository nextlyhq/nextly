import { text, textarea, type FieldConfig } from "nextly";

/**
 * The default SEO fields contributed onto each target collection (D12 extend).
 * Matches the RFC §7.1 example (`metaTitle` + `metaDescription`). Integrators
 * can override the whole set via `seo({ fields })` — e.g. to add an `metaImage`
 * upload (relationTo: "media") or canonical/robots fields.
 */
export function defaultSeoFields(): FieldConfig[] {
  return [
    text({ name: "metaTitle", label: "Meta Title", maxLength: 60 }),
    textarea({
      name: "metaDescription",
      label: "Meta Description",
      maxLength: 160,
    }),
  ];
}
