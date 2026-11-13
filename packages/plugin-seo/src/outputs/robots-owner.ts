/**
 * Whether the site serves a robots.txt of its own, which Next.js serves
 * before the plugin's (a `public/robots.txt` or an `app/robots.ts`), so the
 * plugin's rules, the site's own lines in the settings among them, are not
 * what crawlers read. Then no page is said to be blocked by them, and no
 * block asks to be confirmed.
 *
 * Read from the site's robots.txt at its main production address, by the
 * same fetch Inspect uses (only the site's own addresses, each hop held to
 * its rules): the plugin marks its file with a header, so a file without it
 * is the site's. A read that fails, or a site with no known address, says
 * nothing, and the plugin's file is taken as the one served. The answer is
 * kept a few minutes, so a full check reads the file once, not per page.
 *
 * @module outputs/robots-owner
 */
import { productionAddressesOf } from "../canonical";
import { originOf } from "../origin";
import { CRAWLERS } from "../received/contract";
import { fetchAs, type FetchOptions } from "../received/fetch";
import type { SiteRules } from "../resolver/page-levels";
import { ROBOTS_SERVED_BY_HEADER } from "../settings/robots-rules";

/** What the owner is read with. */
export interface RobotsOwnerSetup {
  /**
   * The site's rules as already read by the caller, so asking for every
   * page of a check costs no read of the settings.
   */
  rules: Pick<SiteRules, "productionAddresses">;
  /** The origin the plugin was configured with, where it was. */
  baseUrl?: string | undefined;
  /** How the file is fetched; the network itself unless a test says else. */
  fetch?: Pick<FetchOptions, "resolve" | "transport" | "limits">;
}

/** How long an answer is kept. */
const KEEP_MS = 10 * 60 * 1000;

/** The last answer for each address, and when it was read. */
const kept = new Map<string, { own: boolean; at: number }>();

/** Forgets every kept answer, for a test that starts afresh. */
export function forgetRobotsOwner(): void {
  kept.clear();
}

const GOOGLEBOT =
  CRAWLERS.find(crawler => crawler.key === "googlebot")?.userAgent ??
  "Googlebot/2.1";

/** Whether the robots.txt served at the site's main address is the site's own. */
export async function siteServesOwnRobots(
  setup: RobotsOwnerSetup
): Promise<boolean> {
  const production = productionAddressesOf(setup.rules.productionAddresses);
  const configured = originOf(setup.baseUrl);
  const origins =
    production.length > 0
      ? production
      : configured === undefined
        ? []
        : [configured];
  const origin = origins[0];
  if (origin === undefined) return false;
  const remembered = kept.get(origin);
  if (remembered !== undefined && Date.now() - remembered.at < KEEP_MS) {
    return remembered.own;
  }
  const fetched = await fetchAs(new URL("/robots.txt", origin), GOOGLEBOT, {
    ...setup.fetch,
    origins,
  });
  const own =
    fetched.kind === "received" &&
    fetched.status >= 200 &&
    fetched.status < 300 &&
    fetched.headers[ROBOTS_SERVED_BY_HEADER] === undefined;
  kept.set(origin, { own, at: Date.now() });
  return own;
}
