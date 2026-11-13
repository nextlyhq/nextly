/**
 * What the SEO plugin's optional connections and its admin screens agree on:
 * where their routes are, and what those routes answer. Plain data only,
 * importing nothing, so the admin's client bundle reads it without bringing
 * any server code along.
 *
 * @module connections/contract
 */

/** Where the Connections tab reads the state of every connection. */
export const CONNECTIONS_ROUTE_PATH = "/connections";

/** Where a person starts connecting Search Console. */
export const SEARCH_CONSOLE_CONNECT_PATH =
  "/connections/search-console/connect";

/** Where Google sends a person back after they approve, or refuse, access. */
export const SEARCH_CONSOLE_CALLBACK_PATH =
  "/connections/search-console/callback";

/** Where a person disconnects Search Console. */
export const SEARCH_CONSOLE_DISCONNECT_PATH =
  "/connections/search-console/disconnect";

/** Where the Connections tab reads what Search Console says about the site. */
export const SEARCH_CONSOLE_REPORT_PATH = "/connections/search-console/report";

/** How the last attempt to reach an optional service went. */
export type ConnectionResult =
  | "sent"
  | "refused-key"
  | "rate-limited"
  | "no-address"
  | "refused"
  | "failed";

/** The last attempt, as the screen shows it. */
export interface ConnectionAttempt {
  /** When, as an ISO 8601 time. */
  at: string;
  result: ConnectionResult;
  /** How many addresses it named, where it named any. */
  urls?: number;
}

/** Search Console, as the Connections tab shows it. Never a credential. */
export interface SearchConsoleState {
  /** Whether the site's configuration names a Google sign-in to connect with. */
  configured: boolean;
  /** The Google account and the Search Console property, once connected. */
  connected?: { email?: string; property?: string };
  /** The last attempt that failed, where the last one did. */
  failed?: ConnectionAttempt & { message: string };
}

/** What the connections route answers. */
export interface ConnectionsBody {
  searchConsole: SearchConsoleState;
  /**
   * IndexNow: whether the settings switch it on, and its last attempt to
   * tell search engines, where it made one.
   */
  indexNow: { switchedOn?: boolean; last?: ConnectionAttempt };
}

/** What the connect route answers: where to send the person to sign in. */
export interface SearchConsoleConnectBody {
  url: string;
}

/** One page, as Search Console counts it. */
export interface SearchConsolePageRow {
  page: string;
  clicks: number;
  impressions: number;
}

/** One search, as Search Console counts it. */
export interface SearchConsoleQueryRow {
  query: string;
  clicks: number;
  impressions: number;
}

/** A page where Google chose another official address than the page names. */
export interface SearchConsoleCanonicalRow {
  page: string;
  /** The official address the page names. */
  declared?: string;
  /** The one Google chose. */
  chosen: string;
}

/** What the report route answers: the last 28 days, as Google counts them. */
export interface SearchConsoleReportBody {
  /** The first and last day counted, as `YYYY-MM-DD`. */
  from: string;
  to: string;
  clicks: number;
  pages: SearchConsolePageRow[];
  queries: SearchConsoleQueryRow[];
  /** Of the pages checked (the most clicked), those Google gave another address. */
  otherAddress: SearchConsoleCanonicalRow[];
  /** How many pages were checked for another address. */
  checked: number;
}

/**
 * What IndexNow's last notice said, in plain words, `when` naming the time
 * where the reader shows one; nothing before the first notice. `ok` where
 * nothing needs doing.
 */
export function indexNowLine(
  last: ConnectionAttempt | undefined,
  when?: string
): { ok: boolean; text: string } | undefined {
  if (last === undefined) return undefined;
  const at = when === undefined ? "" : ` ${when}`;
  switch (last.result) {
    case "sent": {
      const pages =
        last.urls === undefined
          ? ""
          : `, about ${last.urls} ${last.urls === 1 ? "page" : "pages"}`;
      return { ok: true, text: `Last told search engines${at}${pages}.` };
    }
    case "refused-key":
      return {
        ok: false,
        text: `Search engines refused the site's IndexNow key${at}. Check that the site serves it at its own address, then save a page to try again.`,
      };
    case "rate-limited":
      return {
        ok: false,
        text: `IndexNow asked the site to slow down${at}. Pages are still found as usual; later changes are sent again.`,
      };
    case "no-address":
      return {
        ok: false,
        text: "No production address is saved, so IndexNow can't name pages. Save it on General.",
      };
    default:
      return {
        ok: false,
        text: `IndexNow could not be reached${at}. Pages are not affected; later changes are sent again.`,
      };
  }
}
