/**
 * Content Settings Single
 *
 * Code-first single demonstrating the chips field type.
 * Tests chips with various configurations in a single document.
 */

import { defineSingle, text, chips } from "@revnixhq/nextly/config";

export default defineSingle({
  slug: "content-settings",
  label: { singular: "Content Settings" },
  admin: {
    group: "Settings",
    icon: "Tag",
    description: "Global content tagging and categorization settings",
  },
  fields: [
    text({
      name: "siteName",
      label: "Site Name",
      required: true,
    }),

    // Basic chips — free-form, no limit
    chips({
      name: "globalTags",
      label: "Global Tags",
      admin: {
        description: "Tags applied site-wide to all content",
        placeholder: "Type a tag and press Enter",
      },
    }),

    // Chips with a limit
    chips({
      name: "featuredTopics",
      label: "Featured Topics",
      maxChips: 6,
      admin: {
        description: "Up to 6 topics shown on the homepage",
        placeholder: "Add a topic",
      },
    }),

    // Required chips with min/max
    chips({
      name: "blockedKeywords",
      label: "Blocked Keywords",
      minChips: 0,
      maxChips: 20,
      admin: {
        description: "Keywords filtered from user-generated content",
        placeholder: "Add a keyword to block",
      },
    }),
  ],
});
