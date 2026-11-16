/**
 * Which addresses the page check may fetch, so it can never be used to make
 * the server reach anywhere but the site's own pages. Asked of the address a
 * person enters and again of every address a redirect leads to:
 *
 * - it is an http(s) address with no user name or password in it;
 * - its host is one of the site's own production addresses;
 * - it uses the standard web port of 80 or 443, or exactly the port the site
 *   is configured on;
 * - and the network address it is connected to is a public one. A site
 *   configured on this machine or its own network by number or as
 *   `localhost`, such as `http://localhost:3000`, may be reached there, and
 *   only at exactly that address; a link-local address, where cloud metadata
 *   services answer, never.
 *
 * @module received/addresses
 */
import { inSentence } from "./contract";
import { kindOfIp } from "./ip";

/** Why an address may not be fetched. */
export type RefusalReason =
  | "no-site"
  | "not-an-address"
  | "scheme"
  | "credentials"
  | "other-site"
  | "port"
  | "private";

/** An address the check will not fetch, and why, in plain words. */
export interface Refusal {
  reason: RefusalReason;
  message: string;
}

/** The ports a page may be fetched on, wherever the site is configured. */
const WEB_PORTS = new Set(["80", "443"]);

/** The port `url` connects to, its scheme's own where it names none. */
function portOf(url: URL): string {
  if (url.port !== "") return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

/** How a person names one of the site's addresses: its host and port. */
function siteName(origin: string): string {
  return new URL(origin).host;
}

/** The site's addresses, named for a sentence: "a, b and c". */
export function sitesNamed(origins: readonly string[]): string {
  return inSentence(origins.map(siteName));
}

function refusal(reason: RefusalReason, message: string): Refusal {
  return { reason, message };
}

/** `value` as an address, a path read on the site's first address. */
function parsed(value: string, origins: readonly string[]): URL | undefined {
  try {
    return value.startsWith("/") ? new URL(value, origins[0]) : new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * The address `value` names, where the check may fetch it, or why not.
 * `origins` are the site's production addresses; a path is a page on the
 * first of them.
 */
export function addressToCheck(
  value: string,
  origins: readonly string[]
): URL | Refusal {
  if (origins.length === 0) {
    return refusal(
      "no-site",
      "Set the site's production address in the SEO settings first: only the site's own pages can be checked."
    );
  }
  const url = parsed(value.trim(), origins);
  if (url === undefined) {
    return refusal(
      "not-an-address",
      `That isn't a web address. Enter one of the site's pages, such as ${origins[0]}/about.`
    );
  }
  return refusedAt(url, origins) ?? url;
}

/**
 * Why `url` may not be fetched, or nothing where it may: the rule an address
 * a person enters and every redirect it leads to are both held to.
 */
export function refusedAt(
  url: URL,
  origins: readonly string[]
): Refusal | undefined {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refusal("scheme", "Only http and https addresses can be checked.");
  }
  if (url.username !== "" || url.password !== "") {
    return refusal(
      "credentials",
      "Addresses with a user name or password in them can't be checked."
    );
  }
  const own = origins.some(origin => new URL(origin).hostname === url.hostname);
  if (!own) {
    return refusal(
      "other-site",
      `That address is on another site, ${url.host}. Only ${sitesNamed(origins)} addresses can be checked.`
    );
  }
  if (!WEB_PORTS.has(portOf(url)) && !origins.includes(url.origin)) {
    return refusal(
      "port",
      `Only the standard web ports can be checked, and that address uses port ${portOf(url)}.`
    );
  }
  return undefined;
}

/** Whether `hostname` is this machine by name or an address by number. */
function namedLocally(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  return (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    kindOfIp(bare) !== undefined
  );
}

/**
 * Why the check may not connect `url` to the network address `ip`, or
 * nothing where it may: a public address always; a loopback or private one
 * only at exactly an address the site is configured at by number or as
 * `localhost`. Asked of the address the connection is then made to, so what
 * is checked is what is reached.
 */
export function mayConnect(
  url: URL,
  ip: string,
  origins: readonly string[]
): Refusal | undefined {
  const kind = kindOfIp(ip);
  if (kind === "public") return undefined;
  const configuredHere =
    origins.includes(url.origin) && namedLocally(url.hostname);
  if (configuredHere && (kind === "loopback" || kind === "private")) {
    return undefined;
  }
  return refusal(
    "private",
    `${url.hostname} points to an address inside a private network, so it can't be checked.`
  );
}
