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
  date,
  defineCollection,
  number,
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
      // Empty for an address that is gone for good, which answers 410
      // rather than sending the visitor anywhere.
      textarea({ name: "target", label: "To" }),
      // The key of the To address where it is an exact path on this site, so
      // the redirects pointing at an address are found by an index when a
      // chain is joined.
      text({ name: "targetKey", label: "Target key", index: true }),
      checkbox({ name: "permanent", label: "Permanent", defaultValue: true }),
      // The address is gone for good: the Proxy answers 410 Gone, so search
      // engines drop it sooner than they would a 404, and sends no one on.
      checkbox({ name: "gone", label: "Gone", defaultValue: false }),
      // How many requests the redirect has answered, and when it last did,
      // counted by the Proxy in the background (`redirects/hits`).
      number({ name: "hits", label: "Hits", defaultValue: 0 }),
      date({ name: "lastHit", label: "Last hit" }),
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
    // The Proxy counts hits while it answers a request, where expiring a
    // cache is refused; nothing caches a redirect's row, which the Proxy
    // and the plugin's routes read straight from the database.
    revalidate: { disable: true },
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
