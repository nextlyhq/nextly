/**
 * The site's redirects: each sends one old address, or every address below a
 * pattern's fixed part, to a new one.
 *
 * A redirect's From address is held in the address record like a page's, by
 * the redirect itself, so a published page and a redirect never share an
 * address. The rows are kept by language and kept path, as the record is.
 *
 * @module redirects/collection
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  checkbox,
  defineCollection,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

export const REDIRECTS_SLUG = "nx_seo_redirects";

export function redirectsCollection(): CollectionConfig {
  return defineCollection({
    slug: REDIRECTS_SLUG,
    labels: { singular: "Redirect", plural: "Redirects" },
    // Kept by the plugin's own screens and by renames, never edited as rows.
    internal: true,
    fields: [
      // The SHA-256 of the language and the From address: one redirect per
      // address, whatever the collation, and a From address of any length.
      text({
        name: "sourceKey",
        label: "Source key",
        required: true,
        unique: true,
      }),
      // Long text, so an address of any length fits.
      textarea({ name: "source", label: "From", required: true }),
      text({ name: "locale", label: "Language", required: true, index: true }),
      textarea({ name: "target", label: "To", required: true }),
      // The key of the To address where it is an exact path on this site, so
      // the redirects pointing at an address are found by an index when a
      // chain is joined.
      text({ name: "targetKey", label: "Target key", index: true }),
      checkbox({ name: "permanent", label: "Permanent", defaultValue: true }),
      // `automatic` for a page's own move, `person` from the screen,
      // `import` from a file.
      text({ name: "origin", label: "Added by", required: true }),
      textarea({ name: "addedBy", label: "Added by name" }),
    ],
    access: {
      // Constants rather than bare `false`: access rules are validated as
      // callables. The plugin writes as the system; these close the wire API.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    webhooks: false,
    admin: {
      description: "Old addresses and where they now send people.",
    },
  });
}

/**
 * The redirects' slug as this site has it: the plugin's own, or the name the
 * site renamed it to with the plugin's `rename`. A redirect holds its From
 * address in the address record under this name.
 */
export function redirectsSlug(ctx: PluginContext): string {
  return ctx.self.collections[REDIRECTS_SLUG] ?? REDIRECTS_SLUG;
}
