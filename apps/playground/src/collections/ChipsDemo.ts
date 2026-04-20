/**
 * Chips Demo Collection
 *
 * Code-first collection demonstrating the chips field type.
 * Tests chips with various configurations alongside other field types.
 */

import {
  defineCollection,
  text,
  textarea,
  select,
  chips,
  option,
} from "@revnixhq/nextly/config";

const ChipsDemo = defineCollection({
  slug: "chips-demo",
  labels: { singular: "Chips Demo", plural: "Chips Demos" },
  admin: {
    useAsTitle: "title",
    description: "Tests the chips field type in a code-first collection",
  },
  fields: [
    text({
      name: "title",
      label: "Title",
      required: true,
    }),

    // Basic chips field — free-form tags, no limit
    chips({
      name: "tags",
      label: "Tags",
      admin: {
        description: "Add any tags to categorize this article",
        placeholder: "Type a tag and press Enter",
      },
    }),

    // Chips with a maximum limit
    chips({
      name: "keywords",
      label: "SEO Keywords",
      maxChips: 5,
      admin: {
        description: "Up to 5 SEO keywords for this article",
        placeholder: "Add a keyword",
      },
    }),

    // Required chips with min and max
    chips({
      name: "categories",
      label: "Categories",
      required: true,
      minChips: 1,
      maxChips: 3,
      admin: {
        description: "Select 1–3 categories",
        placeholder: "Add a category",
      },
    }),

    select({
      name: "status",
      label: "Status",
      defaultValue: "draft",
      options: [
        option("Draft", "draft"),
        option("Published", "published"),
        option("Archived", "archived"),
      ],
    }),

    textarea({
      name: "summary",
      label: "Summary",
    }),
  ],
});

export default ChipsDemo;
