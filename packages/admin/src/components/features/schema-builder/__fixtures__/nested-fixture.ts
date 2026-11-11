/**
 * The nested fixture: one entity holding every kind of container and row the
 * Builder's outline shows, so that no kind is left out of a test.
 *
 * It holds a group; repeating rows; repeating rows inside repeating rows; a
 * group inside repeating rows; a blocks field accepting two blocks; a field
 * that uses a field group which itself uses another field group; a
 * plugin-owned field nested in a group; a code-owned field; a hidden field; two
 * fields of the same name in different containers; and two sibling fields of
 * the same label and type under different names. Its deepest field sits four
 * levels down (`sections` > `items` > `cta` > `label`).
 *
 * Ids are fixed so a test can name a row; `fieldGroups` is what the outline is
 * handed for the field groups the entity uses, as the Builder loads them.
 * Every test of the outline, and of what later builds on it (moves, focus,
 * the tree's keys, timing), reads this one fixture.
 */
import type { LoadedFieldGroup } from "@admin/lib/builder/outline/outline-model";

import type { BuilderField } from "../types";

/** The entity's own fields, as the Builder holds them. */
export function nestedFixtureFields(): BuilderField[] {
  return [
    {
      id: "f-title",
      name: "title",
      label: "Title",
      type: "text",
      validation: { required: true },
      advanced: { localized: true },
    },
    {
      id: "f-summary-a",
      name: "summary_a",
      label: "Summary",
      type: "textarea",
    },
    {
      id: "f-summary-b",
      name: "summary_b",
      label: "Summary",
      type: "textarea",
    },
    {
      id: "f-internal-note",
      name: "internal_note",
      label: "Internal note",
      type: "text",
      admin: { hidden: true },
    },
    {
      id: "f-show-banner",
      name: "show_banner",
      label: "Show banner",
      type: "checkbox",
    },
    {
      id: "f-banner-text",
      name: "banner_text",
      label: "Banner text",
      type: "text",
      admin: {
        condition: { field: "show_banner", operator: "equals", value: true },
      },
    },
    {
      id: "f-legacy-code",
      name: "legacy_code",
      label: "Legacy code",
      type: "text",
      source: "code",
    },
    {
      id: "f-meta",
      name: "meta",
      label: "Meta",
      type: "group",
      fields: [
        {
          id: "f-meta-title",
          // The same name as the entity's own `title`, in another container.
          name: "title",
          label: "Meta title",
          type: "text",
        },
        {
          id: "f-meta-rating",
          name: "rating",
          label: "Rating",
          type: "number",
          source: "plugin",
          owner: "@acme/reviews",
          locked: true,
        },
      ],
    },
    {
      id: "f-sections",
      name: "sections",
      label: "Sections",
      type: "repeater",
      fields: [
        {
          id: "f-sections-heading",
          name: "heading",
          label: "Heading",
          type: "text",
        },
        {
          id: "f-sections-items",
          name: "items",
          label: "Items",
          type: "repeater",
          fields: [
            {
              id: "f-items-cta",
              name: "cta",
              label: "Call to action",
              type: "group",
              fields: [
                {
                  id: "f-cta-label",
                  name: "label",
                  label: "Button label",
                  type: "text",
                },
                {
                  id: "f-cta-kind",
                  name: "kind",
                  label: "Kind",
                  type: "select",
                  // No options yet: the outline marks this row with an error.
                  options: [],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "f-body",
      name: "body",
      label: "Body",
      type: "blocks",
      blocks: { allow: ["core/heading", "acme/hero"] },
    },
    {
      id: "f-seo",
      name: "seo",
      label: "SEO",
      type: "component",
      component: "seo",
    },
  ];
}

/** The field groups the fixture uses, as the Builder loads them. */
export function nestedFixtureFieldGroups(): Map<string, LoadedFieldGroup> {
  return new Map<string, LoadedFieldGroup>([
    [
      "seo",
      {
        slug: "seo",
        label: "SEO",
        fields: [
          { name: "meta_title", label: "Meta title", type: "text" },
          // The field group uses another field group.
          {
            name: "social",
            label: "Social",
            type: "component",
            component: "social",
          },
        ],
      },
    ],
    [
      "social",
      {
        slug: "social",
        label: "Social",
        fields: [{ name: "handle", label: "Handle", type: "text" }],
      },
    ],
  ]);
}
