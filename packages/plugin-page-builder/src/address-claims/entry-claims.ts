/**
 * The addresses a collection's entry holds while its collection's template is
 * published: `<the collection's address>/<the entry's slug>`, in every
 * language the site serves, while the entry is published.
 *
 * Pure, so the save hook, the template's publish and the start-up pass ask one
 * answer.
 *
 * @module address-claims/entry-claims
 */
import { servedAddress, type ServedAddress } from "./claim-key";

/** The field whose value is an entry's part of its address. */
export const ENTRY_SLUG_FIELD = "slug";

/** Why an entry that should be served has no address to be served at. */
export const NO_ADDRESS = "no-address";

/**
 * Whether a document as stored is published. A collection without a
 * Draft/Published lifecycle stores no status, and every entry of it is live.
 */
export function isPublished(data: Readonly<Record<string, unknown>>): boolean {
  return data.status === undefined || data.status === "published";
}

/**
 * The addresses the entry `data` holds under `address` (the collection's
 * address segments), one per language in `locales`: none while it is not
 * published, and {@link NO_ADDRESS} when it is published with a slug that
 * names no address (missing, empty, or holding a `/` or a character the
 * route refuses), so the caller can refuse or report it.
 */
export function entryAddresses(
  data: Readonly<Record<string, unknown>>,
  address: readonly string[],
  locales: readonly string[]
): readonly ServedAddress[] | typeof NO_ADDRESS {
  if (!isPublished(data)) return [];
  const slug = data[ENTRY_SLUG_FIELD];
  if (typeof slug !== "string" || slug === "") return NO_ADDRESS;
  // Each segment encoded as a request carries it, so a slug holding `/` is
  // one segment that the store refuses, never two that land elsewhere.
  const path = `/${[...address, slug].map(encodeURIComponent).join("/")}`;
  const addresses: ServedAddress[] = [];
  for (const locale of locales) {
    const served = servedAddress(locale, path);
    // Exactly the collection's segments and the slug: a slug the store reads
    // as anything else (a `.` segment, a reserved path) names no address.
    if (
      served === null ||
      served.segments.length !== address.length + 1 ||
      served.segments.at(-1) !== slug
    ) {
      return NO_ADDRESS;
    }
    addresses.push(served);
  }
  return addresses;
}
