/**
 * What the site's content route asks the address store: who holds the path
 * a visitor requested, and which addresses are held, to pre-render.
 *
 * Offered as a plugin service, so the route reaches it through the Direct API
 * it already holds and never computes a claim key itself: the store's keys
 * and its reading of a path stay this plugin's alone.
 *
 * @module address-claims/content-addresses
 */
import { pathOf, servedAddress } from "./claim-key";
import {
  committedAddresses,
  committedClaims,
  committedHolderAt,
  type Claims,
} from "./claim-store";

/** The plugin service the content route reads addresses through. */
export const CONTENT_ADDRESS_SERVICE = "contentAddresses";

/** The document a path is served from. */
export interface ContentAddressHolder {
  /** The collection holding the address: the pages, or an entry's. */
  readonly collection: string;
  /** The holding document's id. */
  readonly id: string;
  /**
   * `"address"` when the document is served at the path itself, `"space"`
   * when the path is a later page of the document's paginated list.
   */
  readonly kind: "address" | "space";
}

/** What the service answers. */
export interface ContentAddressService {
  /**
   * Who holds `path` in `locale` (the site's default language when absent),
   * as last committed, or null when nothing does or the path names no
   * address the site serves.
   */
  holderAt(
    locale: string | undefined,
    path: string
  ): Promise<ContentAddressHolder | null>;
  /**
   * The path the document `id` of `collection` is served at in `locale`
   * (the default language when absent), as last committed, or null when it
   * holds none: where a link to it points.
   */
  pathHeldBy(
    locale: string | undefined,
    collection: string,
    id: string
  ): Promise<string | null>;
  /**
   * Up to `limit` of the addresses collections' entries hold in `locale`,
   * as path segments, from `page` (1 first), with how many there are in all,
   * once any start-up pass over the store still running has finished. Pages'
   * addresses are not among them: the pages route lists its own, with its
   * lists' later pages, so they never take a share of the entries' limit.
   */
  addresses(
    locale: string | undefined,
    options: { readonly limit: number; readonly page?: number }
  ): Promise<{ paths: string[][]; total: number }>;
  /**
   * The collections whose writes change who holds an address: the pages,
   * the templates and every collection served under a template address. A
   * cached lookup is refreshed by a write to any of them.
   */
  collections(): readonly string[];
}

/** What the service is built over. */
export interface ContentAddressSetup {
  readonly claims: Claims;
  /** The language a lookup naming none is made in. */
  readonly defaultLocale: () => string;
  readonly collections: readonly string[];
  /**
   * The collections whose documents the site serves: the pages and every
   * collection given a template address now. A claim held by any other (a
   * collection whose address was removed, not yet swept) serves nothing.
   */
  readonly holders: readonly string[];
  /**
   * The collections served under a template address now: the holders whose
   * addresses are listed for pre-rendering.
   */
  readonly entryHolders: readonly string[];
  /**
   * The start-up passes over the store while they run, or null. The listing
   * of addresses joins it, so what is pre-rendered is the store the passes
   * leave, never one they are still filling or moving. A lookup of one path
   * does not wait: it answers per request, and the passes settle it.
   */
  readonly startup?: () => Promise<unknown> | null;
}

/** The service over the installed store. */
export function contentAddressService(
  setup: ContentAddressSetup
): ContentAddressService {
  return {
    holderAt: async (locale, path) => {
      const address = servedAddress(locale ?? setup.defaultLocale(), path);
      if (address === null) return null;
      const held = await committedHolderAt(setup.claims, address);
      return held === null || !setup.holders.includes(held.holder.collection)
        ? null
        : {
            collection: held.holder.collection,
            id: held.holder.id,
            kind: held.kind,
          };
    },
    pathHeldBy: async (locale, collection, id) => {
      if (!setup.holders.includes(collection)) return null;
      const language = locale ?? setup.defaultLocale();
      const { rows } = await committedClaims(
        setup.claims,
        {
          kind: { equals: "address" },
          holderCollection: { equals: collection },
          holderId: { equals: id },
          locale: { equals: language },
        },
        { limit: 1 }
      );
      // Matched again exactly, as every read of the store is.
      const row = rows.find(
        found =>
          found.kind === "address" &&
          found.holder?.collection === collection &&
          found.holder.id === id &&
          found.address?.locale === language
      );
      return row?.address ? pathOf(row.address) : null;
    },
    addresses: async (locale, { limit, page = 1 }) => {
      // The passes never reject, so joining one only waits for it.
      await setup.startup?.();
      const { addresses, total } = await committedAddresses(
        setup.claims,
        locale ?? setup.defaultLocale(),
        { limit, page, holders: setup.entryHolders }
      );
      return { paths: addresses.map(at => [...at.segments]), total };
    },
    collections: () => [...setup.collections],
  };
}
