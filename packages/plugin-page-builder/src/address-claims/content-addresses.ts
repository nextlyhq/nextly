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
import { servedAddress } from "./claim-key";
import {
  committedAddresses,
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
   * Up to `limit` of the addresses held in `locale`, as path segments, from
   * `page` (1 first), with how many there are in all.
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
      return held === null
        ? null
        : {
            collection: held.holder.collection,
            id: held.holder.id,
            kind: held.kind,
          };
    },
    addresses: async (locale, { limit, page = 1 }) => {
      const { addresses, total } = await committedAddresses(
        setup.claims,
        locale ?? setup.defaultLocale(),
        { limit, page }
      );
      return { paths: addresses.map(at => [...at.segments]), total };
    },
    collections: () => [...setup.collections],
  };
}
