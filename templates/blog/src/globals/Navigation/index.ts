/**
 * Navigation single: header + footer link lists + top-level UI toggles.
 *
 * Why a single and not a collection: navigation is one document per site.
 * Editors should not create "navigations" - they should edit THE navigation.
 * `defineSingle` is the right shape.
 *
 * Arrays hold the link items. Each link has a label, href, and optional
 * `openInNewTab` flag (for external links). The footer has a separate
 * array so editors can curate which links appear in the footer "Read"
 * column independently from the top-level header nav.
 */
import { defineSingle, text, checkbox, array } from "@revnixhq/nextly/config";

export const Navigation = defineSingle({
  slug: "navigation",
  label: { singular: "Navigation" },
  fields: [
    array({
      name: "headerLinks",
      fields: [
        text({ name: "label", required: true }),
        text({ name: "href", required: true }),
        checkbox({ name: "openInNewTab", defaultValue: false }),
      ],
    }),
    array({
      name: "footerReadLinks",
      fields: [
        text({ name: "label", required: true }),
        text({ name: "href", required: true }),
      ],
    }),
    checkbox({ name: "showThemeToggle", defaultValue: true }),
    checkbox({ name: "showSearchIcon", defaultValue: true }),
  ],
});
