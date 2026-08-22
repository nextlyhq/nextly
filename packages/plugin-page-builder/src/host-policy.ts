/**
 * The site's host-fetch policy, on both sides of the wire.
 *
 * The host declares `remotePatterns` once. Three surfaces then have to agree
 * about it: the Site Style write gate, which refuses a stored class whose
 * `url()` names an undeclared host; the editor canvas, which draws the same
 * blocks the published page draws; and the inspector, which judges a value at
 * the keystroke. They agree because the derivation lives here and each calls
 * it, rather than each deriving its own.
 *
 * ## Absent is not empty
 *
 * The two are opposite answers and the distinction runs through every function
 * below. `undefined` means the question was never asked, which leaves the
 * engine's scheme allowlist as the only limit — the behaviour of every site
 * that has not configured a host list. An empty array means the question was
 * asked and nothing remote is allowed. Collapsing them either way breaks
 * somebody: reading absent as empty refuses every remote image on sites that
 * never opted in, and reading empty as absent turns a deliberate lockdown into
 * no policy at all.
 *
 * ## Isomorphic on purpose
 *
 * Only the engine is imported — no `css-tree`, no React, no Node builtin — so
 * the browser can derive the same predicate the server does from the patterns
 * it receives through `clientConfig`. `core/url-policy` answers a different and
 * heavier question, which URLs a stylesheet's TEXT fetches, and parsing CSS is
 * not something the admin bundle should carry to find out whether a host is
 * allowed.
 *
 * @module @nextlyhq/plugin-page-builder/host-policy
 */
import {
  isFetchableUrl,
  isPlainRecord,
  type MayFetchUrl,
  type RemotePattern,
} from "@nextlyhq/blocks-engine";

/**
 * What a surface is told about where this site may fetch from.
 *
 * The key is OPTIONAL rather than the function being nullable, because the
 * consumers spread this into their own options and an explicit
 * `mayFetchUrl: undefined` is not the same as an absent key to a reader that
 * checks with `in` or that spreads it over a default.
 */
export interface HostFetchPolicy {
  mayFetchUrl?: MayFetchUrl;
}

/**
 * The predicate a site's declared patterns amount to.
 *
 * `isFetchableUrl` is the engine's, so the editor, the write gate and the
 * published compiler cannot disagree about what a host list means — a URL
 * refused on the canvas and served from the site sheet is exactly the
 * divergence a second matcher produces.
 */
export function hostFetchPolicy(
  patterns: readonly RemotePattern[] | undefined
): HostFetchPolicy {
  if (patterns === undefined) return {};
  return { mayFetchUrl: (url: string) => isFetchableUrl(url, patterns) };
}

/**
 * The optional fields that constrain a URL's TEXT, all of them plain strings.
 *
 * Listed once rather than checked one at a time, because the check is the same
 * for each and a per-field `if` is where one gets forgotten — and a forgotten
 * constraint is the widening `readPattern` exists to refuse.
 */
const TEXT_CONSTRAINTS = ["port", "pathname", "search"] as const;

/**
 * Whether a value is a pattern whose every stated constraint this build can
 * enforce.
 *
 * A type predicate rather than a cast: after these checks the value genuinely
 * satisfies the interface, and saying so with a guard is what lets the caller
 * destructure it without asserting anything.
 */
function enforceablePattern(value: unknown): value is RemotePattern {
  if (!isPlainRecord(value)) return false;
  if (typeof value.hostname !== "string") return false;
  const { protocol } = value;
  if (protocol !== undefined && protocol !== "http" && protocol !== "https") {
    return false;
  }
  return TEXT_CONSTRAINTS.every(
    field => value[field] === undefined || typeof value[field] === "string"
  );
}

/**
 * One entry, narrowed, or `undefined` when it is not a pattern this build can
 * enforce.
 *
 * A malformed optional field REFUSES THE WHOLE ENTRY rather than being dropped,
 * and that is the opposite of how the site-style reader treats a bad row. The
 * reason is that here the fields are CONSTRAINTS: `isAllowedRemoteUrl` reads an
 * omitted `port`, `pathname`, `search` or `protocol` as "any", so dropping one
 * hands back a pattern WIDER than the operator wrote — a `pathname: "/logos/*"`
 * that fails to narrow becomes the whole host. Dropping a bad token or class
 * removes something; dropping a bad constraint adds something.
 *
 * Refusing also matches what the server does with the same value. Given
 * `port: 8080` as a number, `isAllowedRemoteUrl` compares it against
 * `URL.port`, which is always a string, so the entry matches nothing there
 * either. Reading it as "any port" on this side would accept URLs the page
 * refuses, which is the exact divergence this module exists to prevent.
 *
 * Keys this build does not know are IGNORED rather than refused, because they
 * cannot be constraints anywhere: the matcher reads these five fields and no
 * others, so an unknown key narrows nothing on the server either. Refusing over
 * one would reject a pattern the published page honours.
 */
function readPattern(value: unknown): RemotePattern | undefined {
  if (!enforceablePattern(value)) return undefined;
  const { hostname, protocol, port, pathname, search } = value;
  // Rebuilt field by field rather than returned as it arrived, so what leaves
  // here holds the five fields the matcher reads and nothing else. Keeping the
  // caller's object would be harmless to matching and would hand a typed
  // `RemotePattern` to the rest of the editor while it still carried whatever
  // arrived beside it.
  return {
    hostname,
    ...(protocol === undefined ? {} : { protocol }),
    ...(port === undefined ? {} : { port }),
    ...(pathname === undefined ? {} : { pathname }),
    ...(search === undefined ? {} : { search }),
  };
}

/**
 * The host's declared patterns, read back from serialized client config.
 *
 * Returns `undefined` only for a host that declared NOTHING. A value that is
 * present and unreadable — not an array, or an array of things that are not
 * patterns — narrows to the empty list rather than to `undefined`, and the
 * asymmetry is deliberate: this is a security control, so it fails toward the
 * annoyance. An empty list still allows every relative URL, which is what
 * locally-uploaded media is, so the failure an operator sees is remote images
 * disappearing from the canvas rather than a silently unbounded editor.
 *
 * Unreadable ENTRIES are dropped rather than refusing the whole list, which
 * moves in the same direction — one host stops being allowed instead of all of
 * them — and it is the opposite direction from dropping a malformed FIELD,
 * which `readPattern` refuses over for exactly that reason.
 */
export function readRemotePatterns(
  value: unknown
): readonly RemotePattern[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const patterns: RemotePattern[] = [];
  for (const entry of value) {
    const pattern = readPattern(entry);
    if (pattern !== undefined) patterns.push(pattern);
  }
  return patterns;
}
