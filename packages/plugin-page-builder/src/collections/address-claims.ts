/**
 * Who holds each served address: the store a save asks before it gives a
 * document an address, so no two documents are served at one.
 *
 * One row per claim, keyed by `claimKey` (see `address-claims/claim-key`): an
 * address a document holds, a paginated list's page-segment space, a document
 * waiting for an address another holds, or the lock row a space's claims are
 * serialised on. The key is the only unique column, and it is what refuses a
 * second holder: a collection's composite indexes never reach the schema
 * pipeline, so the namespaced key stands in for one. It is stored as the
 * key's SHA-256 in hex (see `storedKey`), so two keys collide exactly when
 * they are the same text on every dialect, whatever its collation, and a key
 * of any length fits.
 *
 * @module collections/address-claims
 */
import {
  defineCollection,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

export const ADDRESS_CLAIMS_SLUG = "nx_pb_address_claims";

export function addressClaimsCollection(): CollectionConfig {
  return defineCollection({
    slug: ADDRESS_CLAIMS_SLUG,
    labels: { singular: "Address claim", plural: "Address claims" },
    // Bookkeeping the plugin keeps, never authored: `internal` keeps it out
    // of the admin's navigation, and the access rules below keep it off the
    // wire.
    internal: true,
    fields: [
      text({
        name: "claimKey",
        label: "Claim key",
        required: true,
        unique: true,
      }),
      // Indexed: the waiting report pages and counts by kind alone, and the
      // lock rows kept for every address ever claimed outgrow the waits.
      text({ name: "kind", label: "Kind", required: true, index: true }),
      text({ name: "locale", label: "Locale" }),
      // The address as the key spells it, so a report reads it back without
      // parsing keys. Long text, so an address of any length fits.
      textarea({ name: "path", label: "Path" }),
      // Indexed because releasing a document's claims finds them by holder,
      // and the addresses listed for pre-rendering are those of entry
      // holders' collections.
      text({
        name: "holderCollection",
        label: "Holder collection",
        index: true,
      }),
      text({ name: "holderId", label: "Holder id", index: true }),
      // For an address claim, the stored key of the space that would hold
      // it, so a list paginating there finds the addresses already inside.
      text({ name: "space", label: "Space", index: true }),
      // For a waiting row, the stored key of the claim it waits on, so
      // releasing that claim finds who is waiting for it.
      text({ name: "blockedBy", label: "Blocked by", index: true }),
    ],
    access: {
      // Functions returning a constant rather than bare `false`: access rules
      // are validated as callables. The plugin's own writes run as the system,
      // which these do not apply to, so they close the wire API and nothing
      // else. Read is closed too: the rows map every address on the site to
      // the document holding it, unpublished ones included.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // An omitted option records an event per write; every claim would then
    // reach a site's `entry.*` webhooks, which access rules do not filter.
    webhooks: false,
    admin: {
      description:
        "Which document holds each served address. Maintained automatically.",
    },
    timestamps: false,
  });
}
