import { measureBytes } from "@nextlyhq/blocks-engine";
import type { PluginRoutePermissionScope } from "@nextlyhq/plugin-sdk";
/**
 * The one read the insert panel makes to find out what it may offer.
 *
 * ## Why a route rather than the collection API
 *
 * The panel needs one index, and the index has two sources: rows in the
 * `patterns` collection, and patterns a plugin DECLARES in code. Only a server
 * can see both, so the merge has to happen here — and doing it in one place is
 * what keeps the panel from growing a second notion of what a pattern is.
 *
 * Measured, there is also nothing else available: the admin's own collection
 * hooks are not exported from `@nextlyhq/plugin-sdk/admin`, which is the only
 * surface this package may import from, so a browser-side read of the
 * collection is not merely worse here — it does not exist.
 *
 * ## Published only, and NOT by saying so
 *
 * A draft pattern is one being worked on, and offering it would put a
 * half-built starting point in front of every author on the site. The read is
 * bounded to public states — but by the SERVICE, because it runs as the user,
 * and an untrusted caller that states no lifecycle gets exactly that.
 *
 * A literal `where.status = "published"` looked like the same thing and is not,
 * in two ways. It is ANDed with the service's own release-aware condition,
 * which deliberately reveals a draft belonging to a release whose time has come
 * but whose drain has not run — so the literal hides it again, and on an
 * installation with no scheduler it stays hidden indefinitely. And "published"
 * is a state NAME: a collection whose workflow calls its public state something
 * else matches nothing, and the library comes back empty with no error. The
 * service asks the workflow which states are public; this cannot.
 *
 * ## No declared permission, deliberately
 *
 * The route is authenticated — a plugin route without `public: true` is — and
 * the read runs AS THE USER, so core enforces whatever read permission the
 * `patterns` collection actually seeded. Naming one here would have to spell
 * the collection slug, and a host may rename that collection: the permission
 * would then be seeded under the new name and refused under the old one, which
 * is a route nobody can call. The service knows the resolved name; this does
 * not.
 *
 * @module library-route
 */

import { PATTERNS_SLUG } from "./collections/patterns";
import {
  LIBRARY_ROUTE_PATH,
  type LibraryPattern,
  type LibraryResponse,
} from "./library-contract";

/**
 * How many rows one read of the collection asks for.
 *
 * The service defaults to ten, which would make a library of any size a long
 * run of round trips. Large enough that an ordinary site is one request, small
 * enough that one response is not an unbounded amount of memory.
 */
export const LIBRARY_PAGE_SIZE = 100;

/**
 * The most patterns this will return, however many are stored.
 *
 * A ceiling rather than an unbounded loop, for the reason the submissions
 * export has one: a collection nothing caps could hold the whole table in
 * memory on one request. The design sizes the library at three thousand, so
 * this is the size it is expected to reach rather than a number pulled from
 * nowhere — and reaching it is REPORTED rather than silently truncating a list
 * the author would then search in vain.
 */
export const MAX_LIBRARY_PATTERNS = 3000;

/**
 * The most reads one library request will make.
 *
 * Derived from the two numbers above rather than chosen, so it cannot drift
 * from them — and it bounds the REQUESTS, which the pattern ceiling does not.
 * A page every row of which this reader drops adds nothing to the kept count,
 * so a ceiling counting only kept patterns is never reached and the loop asks
 * for page after page forever. Measured while breaking this: a stop condition
 * on the kept count spun until the process died.
 */
const MAX_LIBRARY_PAGES = Math.ceil(MAX_LIBRARY_PATTERNS / LIBRARY_PAGE_SIZE);

/**
 * The most bytes of pattern documents one library read will carry.
 *
 * A count cannot bound this. One valid blocks document may be two mebibytes by
 * default and a host may raise that cap, so three thousand of them is gigabytes
 * held in memory on the server and then sent to a browser — from a request an
 * author makes by opening the editor.
 *
 * Sixteen mebibytes: large enough that an ordinary library arrives whole, small
 * enough to be a payload rather than an outage. Reaching it is REPORTED, like
 * every other ceiling here, so the surface can say the library was cut rather
 * than let an author search for a pattern that was silently left out.
 *
 * An upper bound on what comes back, not a line the last row is allowed to
 * cross: every row is weighed before it is kept, so a response never totals
 * more than this.
 */
export const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;

/**
 * What one row costs on the wire, or nothing when it cannot be sent at all.
 *
 * THE WHOLE ROW, not the document. Charging only the document meant charging
 * the one field that happened to have no bound of its own, and `description` is
 * a `textarea` on the patterns collection with no length either — so a library
 * of long descriptions and absent documents was scored at exactly zero and no
 * ceiling was ever consulted. Measured, sixty such rows serialised to 24.0 MB
 * against a 16 MiB ceiling. A budget on what is SENT has to weigh what is sent.
 *
 * The ENGINE's measurement, not a second definition of a byte, and the generic
 * one rather than `documentBytes`: that takes a document, while what travels
 * here is a row. `measureBytes` is the same survey the canonical validator asks
 * its size question through, so this agrees with the ceiling a stored document
 * already passed rather than disagreeing the first time a block gains a prop.
 * It counts UTF-8, which is what a byte means on the wire — `String.length`
 * counts UTF-16 code units, and a library measured that way passed roughly
 * three times its nominal ceiling.
 *
 * It is also BOUNDED: it stops at the limit rather than walking a row that is
 * already too big, so weighing a hundred-mebibyte row does not itself cost a
 * hundred mebibytes.
 *
 * A row that cannot be serialised is REFUSED rather than counted as free. An
 * `afterRead` hook may hand back a document holding a bigint or a cycle;
 * counting that as costing nothing kept it, and the serialisation of the
 * assembled library then threw — so one malformed row answered the author with
 * a failed request instead of a shorter list. `undefined` says so, and the
 * caller drops the row exactly as it drops one it could not key or label.
 */
function rowCost(pattern: LibraryPattern): number | undefined {
  const measured = measureBytes(pattern, MAX_LIBRARY_BYTES);
  if (measured.exceeded && measured.reason === "unwritable") return undefined;
  return measured.bytes;
}

/**
 * What the answer costs before a single pattern is in it.
 *
 * The rows are what the budget counted and the rows are not what is sent:
 * `Response.json` wraps them in `{"items":[…],"meta":{…}}`. A library whose
 * rows totalled exactly the ceiling therefore left the server ABOVE it —
 * measured, nine bytes over — so a proxy or platform limit set at the same
 * figure rejects a response this route believed it had bounded.
 *
 * Computed from the envelope rather than written down, so it cannot drift from
 * the shape actually returned, and at its WORST case: the largest count this
 * can report, and `false`, which is a byte longer than `true`.
 */
const RESPONSE_FRAMING_BYTES = measureBytes(
  { items: [], meta: { count: MAX_LIBRARY_PATTERNS, truncated: false } },
  Number.MAX_SAFE_INTEGER
).bytes;

/**
 * What one more row costs beyond itself: the comma that separates it.
 *
 * Charged to every row including the first, which over-counts by one byte for
 * a library of one. Conservative in the direction that keeps the ceiling a
 * ceiling, and a byte is not worth a special case.
 */
const ROW_SEPARATOR_BYTES = 1;

/** The capabilities this route uses, named rather than imported whole. */
export interface LibraryRouteContext {
  self: { collections: Record<string, string | undefined> };
  user: unknown;
  services: {
    collections: {
      listEntries(
        collection: string,
        options: unknown,
        context: unknown
      ): Promise<{
        data: unknown[];
        // The SERVICE's answer to whether more rows exist. A page can come back
        // shorter than asked for without the collection ending — an `afterRead`
        // hook may drop rows — so a length check stops early and every pattern
        // on later pages disappears. It also cannot tell a library that ends
        // exactly at the ceiling from one that does not.
        pagination?: { hasMore?: boolean };
      }>;
    };
  };
}

/**
 * Read the library, as the user asking for it.
 *
 * Separate from the route declaration so it can be tested against a stub
 * without a server: what this decides — which rows travel, how many, and what
 * of each — is the part worth holding still, and a handler that only exists
 * inside `contributes.routes` can only be tested by booting one.
 */
export async function readPatternLibrary(
  ctx: LibraryRouteContext
): Promise<LibraryResponse> {
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;
  // AS THE USER. A route reading with the instance's own identity would answer
  // every caller with every pattern, whatever the collection's permissions say.
  const asUser = { as: "user" as const, user: ctx.user ?? undefined };

  const items: LibraryPattern[] = [];
  let truncated = false;
  // Accumulated rather than assigned, unlike `truncated`: an oversized row on
  // page one is a cut library even when page nine simply ends, and the stop
  // reason below overwrites what it knows nothing about.
  let omitted = false;
  // Seeded with what the envelope costs, so the ceiling bounds the ANSWER
  // rather than the rows inside it.
  let bytes = RESPONSE_FRAMING_BYTES;
  for (let page = 1; ; page += 1) {
    const result = await ctx.services.collections.listEntries(
      slug,
      {
        // NO status predicate, deliberately — see the module docblock.
        //
        // A DETERMINISTIC order, because these are independent offset queries.
        // The service adds `ORDER BY` only when a sort is asked for, and an
        // unordered offset read is free to return rows in a different order per
        // page — so one pattern can arrive twice and another never at all,
        // assembled into a library nobody can explain. `id` is the unique key,
        // which is what makes it a tie-breaker rather than another ambiguity;
        // the panel decides how to PRESENT them.
        sort: { field: "id", direction: "asc" as const },
        pagination: { limit: LIBRARY_PAGE_SIZE, page },
      },
      asUser
    );
    const page_ = collectPage(result.data, items, bytes);
    bytes = page_.bytes;
    omitted ||= page_.omitted;
    if (page_.full) {
      truncated = true;
      break;
    }

    const stop = whyStop({
      hasMore: result.pagination?.hasMore === true,
      page,
    });
    if (stop === undefined) continue;
    truncated = stop === "cut";
    break;
  }

  return {
    items,
    meta: { count: items.length, truncated: truncated || omitted },
  };
}

/** What one page added, and whether the ceilings are now reached. */
interface Collected {
  /** The running byte total, including this page. */
  readonly bytes: number;
  /** Whether a ceiling stopped the collection part-way. */
  readonly full: boolean;
  /**
   * Whether a row was left out for its own size while the read went on.
   *
   * Told apart from {@link full} because the two say different things about
   * what happens next: a spent budget ends the read, while a pattern that fits
   * in no budget is one row skipped. Both mean the library is incomplete, which
   * is the one thing the panel has to be told.
   */
  readonly omitted: boolean;
}

/** What the ceilings say about one row, before it is appended to anything. */
type RowVerdict = "keep" | "omit" | "stop";

/**
 * Whether this row travels, decided BEFORE it is appended.
 *
 * Appending and then checking makes the ceiling a description of the response
 * rather than a bound on it: the row that crosses the budget has already been
 * kept, so a single document larger than the whole budget comes back whole.
 * Measured, that returned 17.8 MB against a 16 MiB ceiling.
 *
 * A row that does not fit in an EMPTY budget fits in no budget, so it is
 * omitted and the read goes on. Ending there would hide every pattern behind
 * it on account of one the panel could not have offered anyway — the same
 * direction an unreadable row moves in, one pattern dropped instead of all of
 * them. A row that would merely overflow what is LEFT means the budget is
 * spent, and reading further only assembles bytes that cannot be sent.
 */
function admits(charged: number, spent: number, kept: number): RowVerdict {
  // Against an EMPTY response rather than against nothing: a row that cannot
  // fit beside the framing alone cannot fit anywhere.
  if (RESPONSE_FRAMING_BYTES + charged > MAX_LIBRARY_BYTES) return "omit";
  if (spent + charged > MAX_LIBRARY_BYTES) return "stop";
  if (kept >= MAX_LIBRARY_PATTERNS) return "stop";
  return "keep";
}

/**
 * Add this page's readable rows, stopping the moment a ceiling is reached.
 *
 * PER ROW, not once the page is finished. A ceiling checked between pages
 * bounds nothing about the page being read: one page of a hundred two-mebibyte
 * documents is two hundred mebibytes already assembled, and when the collection
 * ends there the read reports it COMPLETE. The budget has to stop the
 * accumulation rather than describe it afterwards.
 *
 * An unreadable ROW is dropped rather than refusing the whole library, which
 * moves in the same direction the remote-pattern reader moves in: one pattern
 * stops being offered instead of all of them. A row with no id or no title is
 * one the panel could neither key nor label; a row that cannot be serialised is
 * one the response could not carry even if it were kept.
 */
function collectPage(
  rows: readonly unknown[],
  into: LibraryPattern[],
  from: number
): Collected {
  let bytes = from;
  let omitted = false;
  for (const row of rows) {
    const pattern = readLibraryRow(row);
    if (pattern === undefined) continue;
    const size = rowCost(pattern);
    // Unsendable, so it is not a question of budget: dropped like a row that
    // could be neither keyed nor labelled, and the read goes on.
    if (size === undefined) {
      omitted = true;
      continue;
    }
    const charged = size + ROW_SEPARATOR_BYTES;
    const verdict = admits(charged, bytes, into.length);
    if (verdict === "stop") return { bytes, full: true, omitted };
    if (verdict === "omit") {
      omitted = true;
      continue;
    }
    into.push(pattern);
    bytes += charged;
  }
  return { bytes, full: false, omitted };
}

/**
 * Whether to ask for another page, and if not, why.
 *
 * Only the reasons that are about the READ rather than about what was kept. The
 * pattern and byte ceilings live in the row loop, because a ceiling checked
 * between pages bounds nothing about the page being read.
 *
 * Told apart as `"ended"` and `"cut"` because only one is something to report:
 * a library that finished is complete, and one that was cut is a library an
 * author would otherwise search in vain.
 */
function whyStop(at: {
  hasMore: boolean;
  page: number;
}): "ended" | "cut" | undefined {
  // The SERVICE's own answer, not a length this recomputes. A page shorter than
  // asked for does not mean the collection ended: an `afterRead` hook may drop
  // rows, and stopping there loses every pattern behind them.
  if (!at.hasMore) return "ended";
  // A bound on the READS, which the per-row ceilings cannot supply: they count
  // what was KEPT, and a page whose every row was dropped keeps none.
  if (at.page >= MAX_LIBRARY_PAGES) return "cut";
  return undefined;
}

/**
 * One stored row, as the panel needs it — or nothing when it is not one.
 *
 * Every field is read defensively. These are stored documents reaching a
 * reader, and a field the collection does not require is written as SQL `NULL`
 * and read back with the KEY PRESENT: `keywords` arrives as `null` for the
 * ordinary pattern saved without any, which is why it is carried as `null`
 * rather than normalised away. The panel's own reader already expects that.
 */
function readLibraryRow(row: unknown): LibraryPattern | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const id = record.id;
  const title = record.title;
  // Both are required by the collection, so a row missing either is one no
  // reader downstream can use: the id is what an insert plans against and the
  // title is the only thing a tile can be found by.
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof title !== "string" || title === "") return undefined;
  return { id, title, ...describedBy(record) };
}

/**
 * The fields a pattern may or may not carry, read off one row.
 *
 * Separate from the identity check above because they answer different
 * questions — whether this row is a pattern at all, and what it says about
 * itself — and because reading them is where all the branching is.
 */
function describedBy(record: Record<string, unknown>): Partial<LibraryPattern> {
  return {
    ...optionalText(record.description, "description"),
    ...optionalText(record.category, "category"),
    ...optionalText(record.granularity, "granularity"),
    ...storedKeywords(record.keywords),
    // The collection stores the tree under `content`; the panel reads
    // `document`. Named here, once, because this is the only place that knows
    // both — and because getting it wrong drops every pattern in silence.
    //
    // Carried whole and unread. What a pattern document must BE is the
    // planner's question, and it asks it before offering the pattern; a second
    // reading here would be a narrower one that disagrees the first time the
    // format gains a field.
    ...(record.content === undefined
      ? {}
      : { document: record.content as LibraryPattern["document"] }),
  };
}

/**
 * The author's search terms, including the `null` a stored row really holds.
 *
 * `null` is carried through rather than normalised away: Nextly writes an unset
 * non-required field as SQL `NULL` and reads it back with the KEY PRESENT, so
 * the ordinary pattern saved without keywords arrives as `null` — and the
 * panel's own keyword reader is written to meet exactly that.
 */
function storedKeywords(value: unknown): { keywords?: string | null } {
  if (value === null) return { keywords: null };
  return typeof value === "string" ? { keywords: value } : {};
}

/** One optional string field, present only when it is actually a string. */
function optionalText(
  value: unknown,
  name: string
): Record<string, string> | Record<string, never> {
  return typeof value === "string" ? { [name]: value } : {};
}

/**
 * The route declaration, thin on purpose.
 *
 * Everything it decides lives in {@link readPatternLibrary}, which a test can
 * reach without booting a server. What is left here is the shape of the
 * contribution — the method, the path, and the fact that it declares no
 * permission — and that is the part a reader of `contributes.routes` needs to
 * see without following a call.
 */
export function patternLibraryRoute(): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: LibraryRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: LIBRARY_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and a COMPUTED
    // `requiredPermission`, which is what keeps it callable on a site that
    // renamed the collection. See the module docblock.
    requiredPermission: ({ collection }) => collection(PATTERNS_SLUG, "read"),
    handler: async (_req: Request, ctx: LibraryRouteContext) =>
      Response.json(await readPatternLibrary(ctx)),
  };
}
