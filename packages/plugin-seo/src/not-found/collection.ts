/**
 * The addresses on the site that people or search engines asked for and that
 * did not exist, one row per address with how often and when it was last
 * asked for, and the old addresses a deploy moved that could not be given a
 * redirect.
 *
 * @module not-found/collection
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  date,
  defineCollection,
  number,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

export const NOT_FOUND_SLUG = "nx_seo_not_found";

export function notFoundCollection(): CollectionConfig {
  return defineCollection({
    slug: NOT_FOUND_SLUG,
    labels: { singular: "Address not found", plural: "Addresses not found" },
    internal: true,
    fields: [
      // The SHA-256 of the address, so one address is one row on every
      // dialect, whatever its length.
      text({
        name: "pathKey",
        label: "Path key",
        required: true,
        unique: true,
      }),
      // The address as it was asked for, without its query.
      textarea({ name: "path", label: "Address", required: true }),
      number({ name: "hits", label: "Visits", required: true, index: true }),
      date({
        name: "lastSeen",
        label: "Last seen",
        required: true,
        index: true,
      }),
      // `missing` for a request that found nothing, `moved` for an old
      // address a deploy moved whose redirect could not be saved.
      text({ name: "kind", label: "Kind", required: true }),
    ],
    access: {
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    webhooks: false,
    admin: {
      description: "Addresses people asked for that do not exist.",
    },
  });
}

/** The log's slug as this site has it, renamed or the plugin's own. */
export function notFoundSlug(ctx: PluginContext): string {
  return ctx.self.collections[NOT_FOUND_SLUG] ?? NOT_FOUND_SLUG;
}
