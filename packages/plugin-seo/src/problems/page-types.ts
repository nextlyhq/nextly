/**
 * The key a page's content type is kept under in the problem list, as the
 * address record keys its holders: a collection's slug, or `single:<slug>`
 * for a Single. Pure, so the routes and the checks read it alike.
 *
 * @module problems/page-types
 */
import type { PublicAddressType } from "@nextlyhq/plugin-sdk";

/** The key a Single's pages are kept under, as the address record keys them. */
const SINGLE_KEY = "single:";

/** A Single's key, `single:<slug>`, as a page's type is kept in the list. */
export const singleKey = (slug: string): string => `${SINGLE_KEY}${slug}`;

/**
 * The content type a page's kept type names: a Single for `single:<slug>`,
 * else the collection of that slug.
 */
export function pageTypeOf(key: string): PublicAddressType {
  return key.startsWith(SINGLE_KEY)
    ? { kind: "single", slug: key.slice(SINGLE_KEY.length) }
    : { kind: "collection", slug: key };
}
