/**
 * The served address a claim is held under, spelled one way.
 *
 * Two documents may not share an address a visitor can reach, so the address
 * a claim holds must have exactly one spelling: `/about`, `/about/`,
 * `//about` and `/%61bout` are one address, and a claim taken under one of
 * them must refuse the others. The key is built from the address's canonical
 * segments, never from the text it arrived as.
 *
 * - The language is a part of its own, `<locale>|<path>`, since one path is a
 *   different address in each language it is published in. How a language
 *   prefixes the URL is the router's to decide, not the key's.
 * - The path is held as segments, so an address of several segments needs no
 *   change of format. Each segment is percent-encoded in the key, so a `/`
 *   inside one can never read as a boundary between two.
 * - No host or tenant is part of it: two sites served from one database
 *   would see each other's addresses as taken.
 *
 * @module address-claims/claim-key
 */
import { slugToStaticParam } from "@nextlyhq/plugin-sdk/routing";

/** An address a document is served at, in its canonical form. */
export interface ServedAddress {
  /** The language it is served in. */
  readonly locale: string;
  /**
   * The path's segments, decoded and otherwise as the route reads them;
   * none is empty.
   */
  readonly segments: readonly string[];
}

/**
 * What a claim row is: an address held by a document, a paginated list's
 * page-segment space, a document waiting for an address another holds, or
 * the row a space's claims are serialised on.
 */
export type ClaimKind = "address" | "space" | "waiting" | "lock";

/**
 * The key's namespace for each kind. `collection:` is kept for a collection's
 * own address, which claims no path, so a page at `/blog` and a collection
 * served from `/blog` are never compared.
 */
const NAMESPACE: Readonly<Record<ClaimKind, string>> = {
  address: "addr",
  space: "space",
  waiting: "wait",
  lock: "lock",
};

/** The segment that numbers a list's later pages: `/news/page/2`. */
const PAGE_SEGMENT = "page";

/**
 * A later page's number as a list spells it: from 2, with no sign and no
 * leading zero. Page 1 is the list's own address, not one of its space's.
 */
const PAGE_NUMBER = /^(?:[2-9]|[1-9]\d+)$/;

/**
 * Whether `path` holds what a browser rewrites before it asks for a path: a
 * backslash, read as a slash, or a tab, line break or other control
 * character, dropped. A path holding one would be a second key for an
 * address already keyed.
 */
function rewrittenByBrowsers(path: string): boolean {
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * `path` without what URL parsing itself strips from both ends: control
 * characters and the ASCII space, and nothing else. A no-break space or
 * another Unicode space stays, since a browser percent-encodes it and the
 * route serves the slug holding it at its own address (`/about%C2%A0`).
 */
function urlTrimmed(path: string): string {
  let start = 0;
  let end = path.length;
  while (start < end && path.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && path.charCodeAt(end - 1) <= 0x20) end -= 1;
  return path.slice(start, end);
}

/** A URL's scheme and host, which are not part of the address it serves. */
const SCHEME_AND_HOST = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

/**
 * The canonical address `path` names in `locale`, or null when it names none
 * a document can be served at: a reserved path (`/admin`, `/api`, …), a `.`
 * or `..` segment, a `/` encoded inside a segment, bad percent-encoding, or a
 * backslash or control character, which a browser would rewrite.
 * Those are refused rather than resolved, so a claim never holds an address
 * other than the one it was asked for.
 */
export function servedAddress(
  locale: string,
  path: string
): ServedAddress | null {
  if (locale === "" || locale.includes("|")) return null;
  const trimmed = urlTrimmed(path);
  if (rewrittenByBrowsers(trimmed)) return null;
  const local = trimmed.replace(SCHEME_AND_HOST, "").replace(/[?#].*$/s, "");
  const segments: string[] = [];
  // Empty pieces are the leading, trailing and doubled slashes.
  for (const piece of local.split("/").filter(piece => piece !== "")) {
    let segment: string;
    try {
      // Decoded only. The content route matches the segments a browser
      // sends without normalising them, so a composed `café` and a
      // decomposed one are two addresses there and must be two here.
      segment = decodeURIComponent(piece);
    } catch {
      return null;
    }
    if (segment === "." || segment === ".." || segment.includes("/")) {
      return null;
    }
    segments.push(segment);
  }
  // The content route's own answer to which paths it serves, so a claim is
  // never held on one it refuses (a reserved path among them).
  if (slugToStaticParam(segments.join("/")) === null) return null;
  return { locale, segments };
}

/** The address's path as a key spells it: each segment percent-encoded. */
export function pathOf(address: ServedAddress): string {
  return `/${address.segments.map(encodeURIComponent).join("/")}`;
}

/** The key of an address, space or lock claim on `address`. */
export function claimKey(
  kind: Exclude<ClaimKind, "waiting">,
  address: ServedAddress
): string {
  return `${NAMESPACE[kind]}:${address.locale}|${pathOf(address)}`;
}

/**
 * The key of `waiter`'s wait for `address` on the claim keyed `blocking`: one
 * per address and blocking claim, so a document blocked twice is served only
 * once both are released, and one moving to another address the same claim
 * blocks waits for the new one as well as the old.
 */
export function waitingKey(
  waiter: { readonly collection: string; readonly id: string },
  address: ServedAddress,
  blocking: string
): string {
  return `${NAMESPACE.waiting}:${encodeURIComponent(waiter.collection)}:${encodeURIComponent(waiter.id)}|${address.locale}|${pathOf(address)}|${blocking}`;
}

/**
 * The list whose page-segment space holds `address`, or null when `address`
 * is not a later page of any list. `/news/page/2` is in the space of `/news`;
 * `/news` itself is not, since the list's first page is a document's own
 * address.
 */
export function spaceHolding(address: ServedAddress): ServedAddress | null {
  const { segments } = address;
  const number = segments.at(-1);
  if (
    segments.length < 2 ||
    segments.at(-2) !== PAGE_SEGMENT ||
    number === undefined ||
    !PAGE_NUMBER.test(number)
  ) {
    return null;
  }
  return { locale: address.locale, segments: segments.slice(0, -2) };
}
