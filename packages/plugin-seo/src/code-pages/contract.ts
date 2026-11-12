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

/**
 * Which level of the published order gave a page's title or description:
 * typed for the page, supplied by its route's code, or worked out from its
 * template, its content type's pattern, its content or the site's defaults.
 */
export type ValueSource =
  | "page"
  | "code"
  | "template"
  | "pattern"
  | "content"
  | "site";

/** Where a page's title and description come from, where it has them. */
export interface ValueSources {
  title?: ValueSource;
  description?: ValueSource;
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
  /** Where its served title and description come from. */
  sources: ValueSources;
  /** The entry the address is, for an address that is one. */
  entry?: {
    kind: "collection" | "single";
    slug: string;
    id: string;
    /** The language of a translation, which its editor opens in. */
    locale?: string;
  };
  /** For a page with no entry: its SEO, typed and automatic. */
  seo?: CodePageSeo;
}

/** The longest title or description a save keeps. */
export const LONGEST_SEO_TEXT = 1000;

/** What a save of a page's SEO sends. */
export interface CodePageSeoInput {
  path: string;
  title: string;
  description: string;
  hidden: boolean;
  image?: string | null;
}

/**
 * How the site's public pages stand, each page counted in exactly one of
 * `hidden`, `bothSet`, `bothWorkedOut` and `oneOfEach`, so the four add up to
 * `total`:
 *
 * - `hidden`: kept out of search, on its own or with its whole type;
 * - of the rest, by where the title and description they are served come
 *   from: `bothSet` where both are set for the page (typed for it, or
 *   supplied by its route's code), `bothWorkedOut` where neither is (each
 *   worked out from a template, a pattern, the content or the site's
 *   defaults, or missing), and `oneOfEach` otherwise.
 */
export interface PageCoverage {
  total: number;
  hidden: number;
  bothSet: number;
  bothWorkedOut: number;
  oneOfEach: number;
}

/** The levels that set a value for the page itself. */
const SET_FOR_PAGE: ReadonlySet<ValueSource | undefined> = new Set([
  "page",
  "code",
]);

/** Which coverage group one listed address falls in. */
export function coverageGroupOf(
  address: Pick<SiteAddress, "standing" | "sources">
): Exclude<keyof PageCoverage, "total"> {
  if (address.standing === "hidden" || address.standing === "type-hidden") {
    return "hidden";
  }
  const title = SET_FOR_PAGE.has(address.sources.title);
  const description = SET_FOR_PAGE.has(address.sources.description);
  if (title && description) return "bothSet";
  if (!title && !description) return "bothWorkedOut";
  return "oneOfEach";
}

/** The coverage of the addresses the Pages screen lists. */
export function coverageOf(
  addresses: readonly Pick<SiteAddress, "standing" | "sources">[]
): PageCoverage {
  const coverage: PageCoverage = {
    total: addresses.length,
    hidden: 0,
    bothSet: 0,
    bothWorkedOut: 0,
    oneOfEach: 0,
  };
  for (const address of addresses) coverage[coverageGroupOf(address)] += 1;
  return coverage;
}
