/**
 * The SEO plugin's record of who holds each public address, kept so no two
 * pages are served at one address in one language.
 *
 * One row per held address (`address`), per range of addresses held as one,
 * such as a paginated list's later pages (`range`), and per lock row taken
 * before reading (`lock`). The claim key is the only unique column, and it is
 * what refuses a second holder of one address: stored as the key's SHA-256 in
 * hex, so two keys collide exactly when they are the same text on every
 * dialect, whatever its collation, and a key of any length fits.
 *
 * @module address-record/collection
 */
import {
  defineCollection,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

export const ADDRESS_RECORD_SLUG = "nx_seo_addresses";

export function addressRecordCollection(): CollectionConfig {
  return defineCollection({
    slug: ADDRESS_RECORD_SLUG,
    labels: { singular: "Public address", plural: "Public addresses" },
    // Bookkeeping the plugin keeps, never authored.
    internal: true,
    fields: [
      text({
        name: "claimKey",
        label: "Claim key",
        required: true,
        unique: true,
      }),
      text({ name: "kind", label: "Kind", required: true, index: true }),
      text({ name: "locale", label: "Locale", index: true }),
      // Long text, so an address of any length fits.
      textarea({ name: "path", label: "Path" }),
      // Indexed because a document's update finds its rows by holder.
      text({
        name: "holderCollection",
        label: "Holder collection",
        index: true,
      }),
      text({ name: "holderId", label: "Holder id", index: true }),
      text({ name: "holderLabel", label: "Holder label" }),
    ],
    access: {
      // Constants rather than bare `false`: access rules are validated as
      // callables. The plugin's own writes run as the system, which these do
      // not apply to, so they close the wire API and nothing else: the rows map
      // every address on the site to the document holding it.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // Every write would otherwise reach a site's `entry.*` webhooks.
    webhooks: false,
    admin: {
      description:
        "Which page holds each public address. Maintained automatically.",
    },
  });
}
