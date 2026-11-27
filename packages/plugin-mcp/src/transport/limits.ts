/**
 * What the door serves and how much it accepts, stated once.
 *
 * The protocol library has a default for each of these, and a default is a decision nobody here
 * made: the next release of the library could change it, and this door would serve something
 * else without a line of it changing. So each is written down, passed to the library
 * explicitly, and read by the tests from here.
 *
 * @module transport/limits
 */
import type { CacheHint } from "@modelcontextprotocol/server";

/**
 * The protocol revisions the door serves: the current one and the two before it, which are what
 * chat apps and coding tools in use speak.
 *
 * Order matters to the library: a 2025-era client that offers a revision not listed here is
 * counter-offered the first 2025-era entry, so the newest of those comes first. The 2026 revision
 * is chosen through `server/discover` and is never counter-offered.
 */
export const SERVED_REVISIONS: readonly string[] = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
];

/**
 * The largest request body the door reads, in bytes: 4 MiB. A larger one is answered `413`
 * before anything is parsed or any server is built, with a message naming this number.
 *
 * Kept at the library's own default rather than lowered: a file an agent sends inside a call
 * travels in the body, so this bound is also the largest such upload.
 */
export const MAX_REQUEST_BYTES: number = 4 * 1024 * 1024;

/**
 * The most array elements and object members, counted together at every depth, that one tool
 * call's arguments may hold. A call with more is refused before its arguments are validated,
 * with a message naming this number, so a body that fits the byte bound cannot still make
 * validation walk hundreds of thousands of nodes.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/**
 * What the door's discovery and tool-list answers say about caching, on the revision that
 * carries cache fields: private to the caller, and never reused. Each caller is shown only what
 * their own credential may use, so a shared cache, or a client keeping an answer past the
 * moment a grant changes, would show one caller another's surface.
 */
export const PRIVATE_ANSWER: CacheHint = { ttlMs: 0, cacheScope: "private" };
