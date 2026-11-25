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
  checkbox,
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
    // Written while a not-found page renders, where Next.js expires no cache
    // tag, and read only by the admin's routes, which no cache holds: a write
    // here has nothing to expire, and trying would log a failure every time.
    revalidate: { disable: true },
    // Every text value here is the plugin's own bookkeeping (keys, ids, languages,
    // paths, states, actors), never translated: each says `localized: false`, so its
    // column stays on the main table, where a lookup by it finds it in every language.
    fields: [
      // The SHA-256 of the language and the address, so one address is one
      // row on every dialect, whatever its length.
      text({
        name: "pathKey",
        localized: false,
        label: "Path key",
        required: true,
        unique: true,
      }),
      // The address asked for, by its language and path as addresses are
      // kept: `/de/alt` is `/alt` in `de`, and the same path on two
      // languages' domains is two addresses.
      text({
        name: "locale",
        localized: false,
        label: "Language",
        required: true,
      }),
      textarea({
        name: "path",
        localized: false,
        label: "Address",
        required: true,
      }),
      // The address exactly as a visitor asked for it, where that is not how
      // the site's language rule spells the kept one (an unprefixed old link
      // on a site whose languages are all prefixed).
      textarea({ name: "asked", localized: false, label: "Asked for" }),
      number({ name: "hits", label: "Visits", required: true, index: true }),
      date({
        name: "lastSeen",
        label: "Last seen",
        required: true,
        index: true,
      }),
      // `missing` for a request that found nothing, `moved` for an old
      // address a deploy moved whose redirect could not be saved.
      text({ name: "kind", localized: false, label: "Kind", required: true }),
      // Where the last visitor sent from another page came from: another
      // site's host, or a path on this site without its query. Empty while
      // every visitor came directly.
      textarea({ name: "cameFrom", localized: false, label: "Came from" }),
      // Someone chose to ignore the address: listed only when asked for.
      checkbox({ name: "ignored", label: "Ignored", defaultValue: false }),
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
