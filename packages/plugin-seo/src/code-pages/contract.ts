/**
 * What the server and the Pages and addresses screen agree on: where the
 * screen is, the routes it reads and saves through, and the shape of every
 * address it lists. It imports only the settings' contract, which imports
 * nothing, so the admin's client bundle reads it without bringing any server
 * code along.
 *
 * @module code-pages/contract
 */
import { SEO_ADMIN_SLUG } from "../settings/contract";

/** The Pages and addresses screen: its path under the plugin, and its component. */
export const PAGES_PAGE: {
  readonly path: "pages";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoPagesPage";
} = {
  path: "pages",
  component: "@nextlyhq/plugin-seo/admin#SeoPagesPage",
};

/** Where the Pages and addresses screen is, for a link. */
export const PAGES_PAGE_HREF: string = `/admin/plugins/${SEO_ADMIN_SLUG}/${PAGES_PAGE.path}`;

/** Where the screen reads every public address the site knows of. */
export const ADDRESSES_ROUTE_PATH = "/pages";

/** Where the screen saves the SEO of a page with no entry. */
export const CODE_PAGE_SEO_ROUTE_PATH = "/pages/seo";

/**
 * Where an address comes from: an entry, a route built in code with no
 * variable part, or an address a route with a variable part declared.
 */
export type AddressSource = "entry" | "built" | "dynamic";

/**
 * What search engines are told about an address: listed; hidden on its own;
 * hidden because its whole content type is; or, for a page built in code,
 * not connected, since its route does not call the plugin's metadata
 * function and so nothing set here reaches it.
 */
export type AddressStanding =
  | "listed"
  | "hidden"
  | "type-hidden"
  | "not-connected";

/**
 * An automatic value, and where it came from: the route's code, the site's
 * title pattern (with the pattern), or the site's defaults.
 */
export interface AutomaticValue {
  value: string;
  from: "code" | "pattern" | "site" | "content";
  pattern?: string;
}

/** The SEO a person set for a page with no entry. */
export interface TypedCodePageSeo {
  title?: string;
  description?: string;
  hidden: boolean;
  /** The share image, by its media id. */
  image?: string;
}

/** A share image as the preview shows it. */
export interface PreviewImage {
  url: string;
  width?: number;
  height?: number;
  /** Where it comes from: chosen here, the route's code, or elsewhere. */
  from: "page" | "code" | "other";
}

/** The SEO of a page built in code: what was typed, and what is automatic. */
export interface CodePageSeo {
  typed: TypedCodePageSeo;
  /**
   * What the page would show with nothing typed for it: the values the panel
   * offers beneath a person's own, and the share image it falls back to.
   */
  automatic: {
    title?: AutomaticValue;
    description?: AutomaticValue;
    image?: PreviewImage;
  };
  /** The share image the page is served, where it has one. */
  image?: PreviewImage;
  /** The site's name, as Google's result and the shared card show it. */
  siteName?: string;
}

/** One public address, as the screen lists it. */
export interface SiteAddress {
  /** The address, from the site's root. */
  path: string;
  /** The page's name: an entry's title, or a code page's name. */
  name: string;
  source: AddressSource;
  /** The entry's content type, or the file of the route that serves it. */
  from: string;
  standing: AddressStanding;
  /** The title search engines are given, where there is one. */
  title?: string;
  /** The page's official address, where it has one. */
  canonical?: string;
  /** The entry the address is, for an address that is one. */
  entry?: { kind: "collection" | "single"; slug: string; id: string };
  /** For a page with no entry: its SEO, typed and automatic. */
  seo?: CodePageSeo;
}

/** What a save of a page's SEO sends. */
export interface CodePageSeoInput {
  path: string;
  title: string;
  description: string;
  hidden: boolean;
  image?: string | null;
}
