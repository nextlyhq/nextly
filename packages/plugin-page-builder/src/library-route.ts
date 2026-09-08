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
 */
const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;

/**
 * Roughly what one pattern will cost on the wire.
 *
 * The DOCUMENT only, because that is the part with no bound of its own — the
 * title, category and keywords are short columns. Measured by serialising,
 * which is what the response does anyway; an estimate from node count would be
 * a second model of the same thing and would disagree the first time a block
 * gained a large prop.
 *
 * A document that cannot be serialised counts as nothing rather than refusing
 * the library: it is one pattern the panel will drop, and the ceiling exists to
 * bound bytes actually sent.
 */
function documentBytesOf(pattern: LibraryPattern): number {
  try {
    const document = pattern.document;
    if (document === undefined || document === null) return 0;
    return JSON.stringify(document)?.length ?? 0;
  } catch {
    return 0;
  }
}

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
  let bytes = 0;
  for (let page = 1; ; page += 1) {
    const result = await ctx.services.collections.listEntries(
      slug,
      // NO status predicate, deliberately — see the module docblock.
      { pagination: { limit: LIBRARY_PAGE_SIZE, page } },
      asUser
    );
    for (const row of result.data) {
      const pattern = readLibraryRow(row);
      // An unreadable ROW is dropped rather than refusing the whole library,
      // which moves in the same direction the remote-pattern reader moves in:
      // one pattern stops being offered instead of all of them. A row with no
      // id or no title is one the panel could neither key nor label.
      if (pattern === undefined) continue;
      items.push(pattern);
      bytes += documentBytesOf(pattern);
    }

    const stop = whyStop({
      hasMore: result.pagination?.hasMore === true,
      kept: items.length,
      bytes,
      page,
    });
    if (stop === undefined) continue;
    if (stop === "cut") {
      truncated = true;
      // Only the pattern ceiling can overshoot, and only by part of a page.
      if (items.length > MAX_LIBRARY_PATTERNS)
        items.length = MAX_LIBRARY_PATTERNS;
    }
    break;
  }

  return { items, meta: { count: items.length, truncated } };
}

/**
 * Whether to ask for another page, and if not, why.
 *
 * Its own function because the loop above has one job — read and keep — and
 * this has four independent reasons to stop, each bounding something the others
 * cannot see. Told apart as `"ended"` and `"cut"` because only one of them is
 * something to report: a library that finished is complete, and a library that
 * was cut is one an author would otherwise search in vain.
 */
function whyStop(at: {
  hasMore: boolean;
  kept: number;
  bytes: number;
  page: number;
}): "ended" | "cut" | undefined {
  // The SERVICE's own answer, not a length this recomputes. A page shorter than
  // asked for does not mean the collection ended: an `afterRead` hook may drop
  // rows, and stopping there loses every pattern behind them.
  if (!at.hasMore) return "ended";
  if (at.kept >= MAX_LIBRARY_PATTERNS) return "cut";
  // BYTES, which the count cannot bound. One valid document may be two
  // mebibytes and a host may raise that, so three thousand of them is gigabytes
  // assembled in memory and then sent to a browser. The editor needs a library
  // it can hold, not the whole of a large one.
  if (at.bytes >= MAX_LIBRARY_BYTES) return "cut";
  // And a bound on the READS, which neither of those supplies: they count what
  // was KEPT, and a page whose every row was dropped keeps none.
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
  handler: (req: Request, ctx: LibraryRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: LIBRARY_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and no
    // `requiredPermission`, which is what keeps it callable on a site that
    // renamed the collection. See the module docblock.
    handler: async (_req: Request, ctx: LibraryRouteContext) =>
      Response.json(await readPatternLibrary(ctx)),
  };
}
