// Field factories + FieldConfig come from the plugin SDK — the stable
// plugin-authoring surface (per AGENTS.md), not core internals.
import {
  checkbox,
  date,
  number,
  text,
  textarea,
  upload,
} from "@nextlyhq/plugin-sdk";
import type { FieldConfig } from "@nextlyhq/plugin-sdk";

// The lengths the SEO tab and the problem list warn past, a leaf.
import { DESCRIPTION_LIMIT, TITLE_LIMIT } from "./problems/text-checks";
import { IMAGE_PREVIEW_SIZES } from "./resolver/display";

/**
 * The default fields placed INSIDE the `seo` group on each target collection
 * (the plugin wraps these in a `group({ name: "seo" })`, so entries expose them
 * at `entry.seo.metaTitle` etc.). Every field is optional.
 *
 * Ships `canonical` + `noindex` by default: a per-page canonical URL and a
 * search-engine opt-out are baseline SEO controls, and shipping them out of the
 * box is a deliberate edge over plugins that make you add them yourself.
 *
 * A title or description of any length is saved: search engines cut a long
 * one to fit the width they show rather than refusing it, so its length is a
 * warning in the SEO tab and the problem list. `hardLengthLimits` refuses a
 * save past those lengths instead, for a site that wants them enforced.
 *
 * Override the whole set via `seoPlugin({ fields })` when a project needs a
 * different shape; overrides stay nested under `seo`.
 */
export function defaultSeoFields(
  options: { hardLengthLimits?: boolean } = {}
): FieldConfig[] {
  const hard = options.hardLengthLimits === true;
  return [
    text({
      name: "metaTitle",
      label: "Meta Title",
      ...(hard ? { maxLength: TITLE_LIMIT } : {}),
    }),
    textarea({
      name: "metaDescription",
      label: "Meta Description",
      ...(hard ? { maxLength: DESCRIPTION_LIMIT } : {}),
    }),
    // The social card's own text, where a person wants it to differ from the
    // Google title and description; empty, the card uses those.
    text({
      name: "socialTitle",
      label: "Title when shared",
    }),
    textarea({
      name: "socialDescription",
      label: "Description when shared",
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
    // Set when the page first appeared on another site, which is the one
    // case a typed canonical may point off this site.
    checkbox({
      name: "canonicalElsewhere",
      label: "This page first appeared on another site",
      defaultValue: false,
    }),
    checkbox({
      name: "noindex",
      label: "Hide from search engines",
      defaultValue: false,
    }),
    // The structured data type this page is described as, where it differs
    // from its content type's: one of the keys the SEO tab offers. Empty is
    // the content type's choice, and a value naming no type is read as empty.
    text({
      name: "structuredDataType",
      label: "Structured data type",
    }),
    // How search results may show the page, Google's display controls. Each
    // is empty or off by default: an empty image preview size follows the
    // site's default, which asks for large previews.
    text({
      name: "maxImagePreview",
      label: "Image preview size",
      validate: (value: unknown) =>
        value === null ||
        value === undefined ||
        value === "" ||
        (IMAGE_PREVIEW_SIZES as readonly unknown[]).includes(value) ||
        "Choose large, standard or none.",
    }),
    // A shorter text under the link. No characters is refused: "no snippet"
    // is how a page shows none, with the words that say what it costs.
    number({
      name: "maxSnippet",
      label: "Text under the link, characters at most",
      min: 1,
    }),
    checkbox({
      name: "nosnippet",
      label: "No text under the link",
      defaultValue: false,
    }),
    checkbox({
      name: "noimageindex",
      label: "Keep this page's images out of image search",
      defaultValue: false,
    }),
    date({
      name: "unavailableAfter",
      label: "Drop from search after",
    }),
    // For other search engines: each its own switch, and nothing else sets
    // either.
    checkbox({
      name: "noarchive",
      label: "noarchive",
      defaultValue: false,
    }),
    checkbox({
      name: "nocache",
      label: "nocache",
      defaultValue: false,
    }),
  ];
}
