/**
 * What the redirects screen and the routes behind it agree on: where the
 * screen is, the routes it reads and writes, and the shapes they answer
 * with. It imports only the settings' contract, which imports nothing, so
 * the admin's client bundle reads it without bringing any server code along.
 *
 * @module redirects/contract
 */
import { SEO_ADMIN_SLUG } from "../settings/contract";

/** The redirects screen: its path under the plugin, and its component. */
export const REDIRECTS_PAGE: {
  readonly path: "redirects";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoRedirectsPage";
} = {
  path: "redirects",
  component: "@nextlyhq/plugin-seo/admin#SeoRedirectsPage",
};

/** Where the redirects screen is, for a link: the menu's and every screen's. */
export const REDIRECTS_PAGE_HREF: string = `/admin/plugins/${SEO_ADMIN_SLUG}/${REDIRECTS_PAGE.path}`;

/** Where the screen's Not found tab is. */
export const NOT_FOUND_TAB_HREF: string = `${REDIRECTS_PAGE_HREF}?tab=notfound`;

/**
 * Where a new redirect from `from` is added: the screen opens its form with
 * From filled in, and To where `to` names one.
 */
export function newRedirectHref(from: string, to?: string | null): string {
  const query = new URLSearchParams({ from });
  if (to !== undefined && to !== null) query.set("to", to);
  return `${REDIRECTS_PAGE_HREF}?${query.toString()}`;
}

/** The routes the screen reads and writes, under the plugin's routes. */
export const REDIRECT_ROUTES: {
  readonly list: "/redirects";
  readonly notFound: "/not-found";
  readonly import: "/redirects/import";
  readonly proxy: "/proxy-status";
} = {
  list: "/redirects",
  notFound: "/not-found",
  import: "/redirects/import",
  // Whether the site's Proxy runs, which redirects and the log depend on.
  proxy: "/proxy-status",
};

/**
 * Whether the site's Proxy runs: `running` where it noted a request lately,
 * `quiet` where its last note is older than a week, and `not-wired` where it
 * never noted one, as on a site whose `proxy.ts` does not hand requests to
 * Nextly. Redirects and the not-found log do nothing without it.
 */
export type ProxyState = "running" | "quiet" | "not-wired";

/** What the proxy status route answers. */
export interface ProxyStatus {
  state: ProxyState;
  /** When the Proxy last noted a request, as an ISO time; null where never. */
  lastSeen: string | null;
}

/**
 * Whether a redirect is for good (301) or for now (302), or the address is
 * gone for good and answers 410 with no To address.
 */
export type RedirectType = "permanent" | "temporary" | "gone";

/** A redirect as the screen shows it, with addresses as visitors open them. */
export interface RedirectView {
  id: string;
  from: string;
  /** Where it sends people; empty for an address that is gone. */
  to: string;
  type: RedirectType;
  /** `automatic` for a page's own move, `person` from the screen, `import` from a file. */
  origin: "automatic" | "person" | "import";
  addedBy: string | null;
  /** Whether the person reading the list added it. */
  byYou: boolean;
  addedAt: string | null;
  /** How many requests it has answered, as the site's Proxy counted them. */
  hits: number;
  /** When it last answered one, as ISO text; null before the first. */
  lastHit: string | null;
}

/** An address not found as the screen shows it. */
export interface NotFoundView {
  id: string;
  /** The address as the visitor asked for it, as the list shows it. */
  path: string;
  /**
   * The address a redirect from it is added by: `path`, or, on another
   * language's domain, the full address, so the redirect is made in the
   * language it was asked for in whichever domain the admin is open on.
   */
  from: string;
  hits: number;
  lastSeen: string;
  /** `moved` for an old address a deploy moved whose redirect could not be saved. */
  kind: "missing" | "moved";
  /** The closest live page, offered as the To address. */
  suggestion: string | null;
  /**
   * Where the last visitor who came from somewhere came from: another
   * site's host, or a path on this site. Null where every one came
   * directly, with no page that linked them.
   */
  cameFrom: string | null;
  /** Someone chose to ignore it: listed only when ignored ones are shown. */
  ignored: boolean;
}

/** What a row of an imported file would do. */
export type ImportRowKind = "new" | "joined" | "replaced" | "same" | "refused";

/** One row of an imported file, as its dry run found it. */
export interface ImportRowView {
  /** The row's line in the file, from 1. */
  line: number;
  from: string;
  to: string;
  kind: ImportRowKind;
  /** What happens, as the screen says it. */
  says: string;
  /** Why a refused row cannot be imported: a loop, or anything else. */
  refusal?: "loop" | "other";
}

/** What reading a file found, and, once imported, how many were saved. */
export interface ImportResult {
  rows: ImportRowView[];
  /** Whether the file was applied: never while any row is refused. */
  applied: boolean;
}
