import {
  defineCollection,
  text,
  textarea,
  number,
  checkbox,
  select,
  chips,
  option,
  repeater,
} from "@revnixhq/nextly/config";

const TestCollection = defineCollection({
  slug: "test-collection",
  labels: { singular: "Test Item", plural: "Test Items" },
  admin: {
    useAsTitle: "title",
    description: "Full-flow test collection with mixed field types",
  },
  fields: [
    text({
      name: "title",
      label: "Title",
      required: true,
    }),
    textarea({
      name: "description",
      label: "Description",
    }),
    number({
      name: "score",
      label: "Score",
    }),
    checkbox({
      name: "isActive",
      label: "Is Active",
      defaultValue: true,
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
    chips({
      name: "tags",
      label: "Tags",
      admin: {
        placeholder: "Type a tag and press Enter",
        description: "Add tags to categorize this item",
      },
    }),
    chips({
      name: "categories",
      label: "Categories",
      required: true,
      minChips: 1,
      maxChips: 5,
      admin: {
        placeholder: "Add a category",
      },
    }),
  ],
});

export default TestCollection;
