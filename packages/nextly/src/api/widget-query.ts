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
import { getCachedNextly } from "../init";

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

/** Parses and validates the request body's shape, without looking at any one query yet. */
function parseQueriesBody(body: unknown): unknown[] | Response {
  const queries = (body as { queries?: unknown } | null)?.queries;

  if (!Array.isArray(queries)) {
    return new Response(
      JSON.stringify({ error: "Body must be { queries: WidgetQuery[] }" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (queries.length > MAX_QUERIES_PER_REQUEST) {
    return new Response(
      JSON.stringify({
        error: `At most ${MAX_QUERIES_PER_REQUEST} queries per request.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  return queries;
}

/** Runs one query, converting any failure -- validation or execution -- into its own slot. */
async function runOne(
  raw: unknown,
  caller: Awaited<ReturnType<typeof readCaller>>
): Promise<QuerySlot> {
  try {
    const query = validateWidgetQuery(raw);
    const result = await executeWidgetQuery(query, caller);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const postWidgetQuery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  await getCachedNextly();

  const body = (await req.json()) as unknown;
  const queries = parseQueriesBody(body);
  if (queries instanceof Response) return queries;

  // Resolve the caller ONCE for the whole batch: role-slug resolution is a
  // database read, and doing it per query would make a 20-widget dashboard pay
  // for it 20 times.
  const caller = await readCaller(auth);

  const results: QuerySlot[] = await Promise.all(
    queries.map(raw => runOne(raw, caller))
  );

  return respondData({ results }, { headers: PRIVATE_NO_STORE_HEADERS });
});
