/**
 * POST /api/dashboard/query
 *
 * Runs a batch of widget queries for the authenticated caller.
 *
 * The wire shape is array-in, array-out from the first release even though the
 * implementation loops. That is deliberate: swapping the loop for a batched
 * executor (one access check per distinct collection rather than per query)
 * then becomes an additive optimization instead of a breaking change.
 *
 * One query's failure is reported in ITS slot rather than failing the batch --
 * a widget that breaks should show its own error card, not blank the dashboard.
 *
 * @module api/widget-query
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { executeWidgetQuery } from "../domains/widgets/execute";
import { validateWidgetQuery } from "../domains/widgets/query";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";

import { readCaller } from "./authenticated-read";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/** No dashboard needs more than this many widgets in one round trip. */
const MAX_QUERIES_PER_REQUEST = 30;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

interface QuerySlot {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Parses and validates the request body's shape, without looking at any one
 * query yet.
 *
 * THROWS rather than returning a hand-built `Response`. Both refusals are
 * about the request body, so they belong in the canonical
 * `{ error: { code, message, requestId } }` envelope every other endpoint in
 * this package answers with and that `parseApiError` reads -- and the only
 * thing that produces it is `withErrorHandler` serializing a thrown
 * `NextlyError`. A response returned from here carried `error` as a STRING, so
 * a client had no code to branch on, no `requestId` to quote in a bug report,
 * and a shape its parser could not read at all.
 *
 * `validation` rather than `invalidInput` because both name a FIELD of the
 * body: the path tells the caller which one, which a flat sentence cannot.
 */
function parseQueriesBody(body: unknown): unknown[] {
  const queries = (body as { queries?: unknown } | null)?.queries;

  if (!Array.isArray(queries)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "queries",
          code: "INVALID_VALUE",
          message: "Body must be { queries: WidgetQuery[] }.",
        },
      ],
    });
  }
  if (queries.length > MAX_QUERIES_PER_REQUEST) {
    throw NextlyError.validation({
      errors: [
        {
          path: "queries",
          code: "TOO_MANY",
          message: `At most ${MAX_QUERIES_PER_REQUEST} queries per request.`,
        },
      ],
      logContext: { submitted: queries.length },
    });
  }
  return queries;
}

/**
 * What a slot says when the failure is not a `NextlyError`.
 *
 * The same sentence `NextlyError.internal` carries, deliberately: a driver or
 * `DbError` message names columns, tables and SQL fragments, and this endpoint
 * is reachable by any authenticated session or API key.
 */
const GENERIC_SLOT_ERROR = "An unexpected error occurred.";

/**
 * Runs one query, converting any failure -- validation or execution -- into
 * its own slot.
 *
 * Two things this catch must do that the original did neither of.
 *
 * It must not put `error.message` on the wire. Every other boundary in this
 * package maps a non-`NextlyError` to `NextlyError.internal`, whose
 * `publicMessage` is generic, and only `toResponseJSON` reaches a caller. Here
 * a `DbError` or a raw driver error was serialized verbatim under HTTP 200 --
 * reproducible with
 * `{"source":"collection:posts","op":"list","where":{"createdAt":{"greater_than":"not-a-date"}}}`.
 * A `NextlyError`'s `publicMessage` IS public by construction, so it passes
 * through; anything else is replaced.
 *
 * And it must not swallow the failure. Isolating a widget's error into its own
 * slot is the point of the batch shape, but the batch still answers 200, so
 * `withErrorHandler` never sees it and neither did the logger. A dashboard
 * whose widgets all fail left no trace anywhere.
 */
async function runOne(
  raw: unknown,
  caller: Awaited<ReturnType<typeof readCaller>>
): Promise<QuerySlot> {
  try {
    const query = validateWidgetQuery(raw);
    const result = await executeWidgetQuery(query, caller);
    return { ok: true, result };
  } catch (error) {
    // Guarded the way `withErrorHandler` guards its own logging call: a
    // thrower's `logContext` is arbitrary, and a cycle or a BigInt in it would
    // throw from inside this catch and fail the whole batch over one slot.
    try {
      getNextlyLogger().error({
        kind: "widget-query-failed",
        ...(NextlyError.is(error)
          ? error.toLogJSON("widget-query")
          : { err: error instanceof Error ? error.stack : String(error) }),
      });
    } catch {
      // Deliberately swallowed; see above.
    }

    return {
      ok: false,
      error: NextlyError.is(error) ? error.publicMessage : GENERIC_SLOT_ERROR,
    };
  }
}

export const postWidgetQuery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  await getCachedNextly();

  const body = (await req.json()) as unknown;
  const queries = parseQueriesBody(body);

  // Resolve the caller ONCE for the whole batch: role-slug resolution is a
  // database read, and doing it per query would make a 20-widget dashboard pay
  // for it 20 times.
  const caller = await readCaller(auth);

  const results: QuerySlot[] = await Promise.all(
    queries.map(raw => runOne(raw, caller))
  );

  return respondData({ results }, { headers: PRIVATE_NO_STORE_HEADERS });
});
