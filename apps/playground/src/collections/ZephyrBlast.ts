import {
  defineCollection,
  text,
  textarea,
  number,
  checkbox,
  select,
  chips,
  option,
} from "@revnixhq/nextly/config";

const ZephyrBlast = defineCollection({
  slug: "zephyr-blast",
  labels: { singular: "Zephyr Blast", plural: "Zephyr Blasts" },
  admin: {
    useAsTitle: "title",
    description: "Unique test collection for verifying full code-first flow",
  },
  fields: [
    text({
      name: "title",
      label: "Title",
      required: true,
    }),
    textarea({
      name: "notes",
      label: "Notes",
    }),
    number({
      name: "priority",
      label: "Priority",
    }),
    checkbox({
      name: "isActive",
      label: "Is Active",
      defaultValue: true,
    }),
    select({
      name: "stage",
      label: "Stage",
      defaultValue: "draft",
      options: [
        option("Draft", "draft"),
        option("Review", "review"),
        option("Live", "live"),
      ],
    }),
    chips({
      name: "tags",
      label: "Tags",
      admin: {
        placeholder: "Add a tag and press Enter",
        description: "Free-form tags",
      },
    }),
    chips({
      name: "regions",
      label: "Regions",
      required: true,
      minChips: 1,
      maxChips: 5,
      admin: {
        placeholder: "Add a region",
        description: "At least 1 region required, max 5",
      },
    }),
  ],
});

export default ZephyrBlast;
