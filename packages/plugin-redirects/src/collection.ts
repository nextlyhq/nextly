import { defineCollection, select, text, type CollectionConfig } from "nextly";

/**
 * The admin-managed redirects collection (mirrors Payload's plugin-redirects):
 * `from` (unique source path) → `to` (destination URL/path), with a 301/302
 * `type`. Editors manage entries in the admin; the Next.js middleware helper
 * applies them at request time.
 */
export function redirectsCollection(slug = "redirects"): CollectionConfig {
  return defineCollection({
    slug,
    labels: { singular: "Redirect", plural: "Redirects" },
    fields: [
      text({
        name: "fromPath",
        label: "From",
        required: true,
        unique: true,
        admin: { description: "Source path, e.g. /old-page" },
      }),
      text({
        name: "toPath",
        label: "To",
        required: true,
        admin: { description: "Destination URL or path, e.g. /new-page" },
      }),
      select({
        name: "type",
        label: "Type",
        defaultValue: "301",
        options: [
          { label: "301 (Permanent)", value: "301" },
          { label: "302 (Temporary)", value: "302" },
        ],
      }),
    ],
  });
}
