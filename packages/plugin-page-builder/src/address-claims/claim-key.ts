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
import {
  LIST_PAGE_SEGMENT,
  listPageNumber,
  slugToStaticParam,
} from "@nextlyhq/plugin-sdk/routing";

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
 * The key of `waiter`'s wait for the later pages of its list at `list` on the
 * claim keyed `blocking`. Spelled apart from an address's wait (its
 * namespace is followed by `space:` and two encoded parts, where an
 * address's has one, and no encoded part holds a `:`), since a page waits
 * for its own address and its list's later pages on separate claims.
 */
export function spaceWaitingKey(
  waiter: { readonly collection: string; readonly id: string },
  list: ServedAddress,
  blocking: string
): string {
  return `${NAMESPACE.waiting}:space:${encodeURIComponent(waiter.collection)}:${encodeURIComponent(waiter.id)}|${list.locale}|${pathOf(list)}|${blocking}`;
}

/**
 * The key of the lock row a holder's own claims are reconciled under, so the
 * start-up pass and a save of the same page take turns. Its namespace is the
 * lock's, but it holds no `|`, which every address's lock key does after its
 * language, so the two never meet.
 */
export function holderLockKey(holder: {
  readonly collection: string;
  readonly id: string;
}): string {
  return `${NAMESPACE.lock}:holder:${encodeURIComponent(holder.collection)}:${encodeURIComponent(holder.id)}`;
}

/**
 * The key of the lock row a collection's entries are claimed under, so an
 * entry's save, its template's publish and a change of its address take
 * turns. Keyed by the collection rather than its address, so a save that has
 * not yet read the address takes the same lock as a change that moves it.
 * Like a holder's lock key, it holds no `|`, so it never meets an address's.
 */
export function collectionLockKey(collection: string): string {
  return `${NAMESPACE.lock}:collection:${encodeURIComponent(collection)}`;
}

/**
 * The list whose page-segment space holds `address`, or null when `address`
 * is not a later page of any list. `/news/page/2` is in the space of `/news`;
 * `/news` itself is not, since the list's first page is a document's own
 * address.
 */
export function spaceHolding(address: ServedAddress): ServedAddress | null {
  const { segments } = address;
  // The route's own reading of a later page, so a list's space holds
  // exactly the addresses the route serves as its pages: from page 2 (page
  // 1 is the list's own address), and no number it would refuse.
  const page = listPageNumber(segments.at(-1) ?? "");
  if (
    segments.length < 2 ||
    segments.at(-2) !== LIST_PAGE_SEGMENT ||
    page === null ||
    page < 2
  ) {
    return null;
  }
  return { locale: address.locale, segments: segments.slice(0, -2) };
}

/**
 * The space key of the list whose later pages hold `address`, as
 * {@link spaceHolding} places it, or null where it is no list's later page:
 * the one answer to which list's space a document is published inside,
 * which a page's save asks of the pages in a space, and an entry's of an
 * index of every published page by the space each stands in.
 */
export function spaceKeyHolding(address: ServedAddress): string | null {
  const space = spaceHolding(address);
  return space === null ? null : claimKey("space", space);
}

/**
 * The addresses among `addresses` that are later pages of one of the lists
 * whose space keys are `spaces`, as {@link spaceKeyHolding} places them.
 */
export function addressesInSpaces(
  addresses: readonly ServedAddress[],
  spaces: ReadonlySet<string>
): ServedAddress[] {
  return addresses.filter(address => {
    const space = spaceKeyHolding(address);
    return space !== null && spaces.has(space);
  });
}
