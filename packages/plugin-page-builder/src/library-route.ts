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
 * ## Published only
 *
 * A draft pattern is one being worked on. Offering it would put a half-built
 * starting point in front of every author on the site, and the collection turns
 * drafts on precisely so a pattern can be edited without being offered.
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

/** Where the panel finds this, under the plugin's own namespace. */
export const LIBRARY_ROUTE_PATH = "/library";

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
 * One pattern, as the panel needs it.
 *
 * The DOCUMENT travels, which is what makes this bigger than an index. The
 * palette runs the planner's whole preflight over each pattern before offering
 * it — a stored row can be the wrong kind, hold no nodes, or nest in a way the
 * rules no longer allow — so a tile exists only for a pattern the planner would
 * actually place. A metadata-only index cannot answer that, and a panel that
 * guessed would offer tiles that accept a click and then refuse.
 */
export interface LibraryPattern {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  /** The author's own search terms, as stored — one string, or unset. */
  readonly keywords?: string | null;
  /** How much of a page this covers; the panel offers `page` differently. */
  readonly granularity?: string;
  /** The stored pattern document, or absent as a stored row's may be. */
  readonly content?: unknown;
}

/** What one library read answers. */
export interface LibraryResponse {
  readonly items: readonly LibraryPattern[];
  readonly meta: {
    /** How many were returned. */
    readonly count: number;
    /** Whether the ceiling stopped the read before the collection ended. */
    readonly truncated: boolean;
  };
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
      ): Promise<{ data: unknown[] }>;
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
  for (let page = 1; ; page += 1) {
    const result = await ctx.services.collections.listEntries(
      slug,
      {
        where: { status: { equals: "published" } },
        pagination: { limit: LIBRARY_PAGE_SIZE, page },
      },
      asUser
    );
    const rows = result.data;
    for (const row of rows) {
      const pattern = readLibraryRow(row);
      // An unreadable ROW is dropped rather than refusing the whole library,
      // which moves in the same direction the remote-pattern reader moves in:
      // one pattern stops being offered instead of all of them. A row with no
      // id or no title is one the panel could neither key nor label.
      if (pattern !== undefined) items.push(pattern);
    }
    // The COLLECTION's page, not the readable subset: a full page every row of
    // which was dropped still means there may be more.
    if (rows.length < LIBRARY_PAGE_SIZE) break;
    if (items.length >= MAX_LIBRARY_PATTERNS) {
      truncated = true;
      items.length = MAX_LIBRARY_PATTERNS;
      break;
    }
    // And a bound on the READS, which the one above cannot supply: it counts
    // patterns kept, and a page whose every row was dropped keeps none.
    if (page >= MAX_LIBRARY_PAGES) {
      truncated = true;
      break;
    }
  }

  return { items, meta: { count: items.length, truncated } };
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
  return {
    id,
    title,
    ...optionalText(record.description, "description"),
    ...optionalText(record.category, "category"),
    ...optionalText(record.granularity, "granularity"),
    // `null` is carried through rather than dropped, because it is what the
    // panel's keyword reader is written to meet.
    ...(record.keywords === null || typeof record.keywords === "string"
      ? { keywords: record.keywords }
      : {}),
    // Carried whole and unread. What a pattern document must be is the
    // planner's question, and it asks it before offering the pattern; a second
    // reading here would be a narrower one that disagrees the first time the
    // format gains a field.
    ...(record.content === undefined ? {} : { content: record.content }),
  };
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
