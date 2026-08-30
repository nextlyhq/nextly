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

import { authorizationGroups, canReadEntity } from "../auth/entity-read-access";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { refreshCollectionSources } from "../domains/widgets/collection-sources";
import { executeWidgetQuery } from "../domains/widgets/execute";
import {
  readWidgetQuery,
  resolveWidgetSource,
  validateReadWidgetQuery,
} from "../domains/widgets/query";
import {
  failUnavailableSourceOrOp,
  sourceTarget,
  type WidgetSource,
} from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { readAccessCaller, readCaller } from "./authenticated-read";
import { readJsonBody } from "./read-json-body";
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
 * Refuses, indistinguishably, unless this caller may read what the source
 * addresses.
 *
 * Runs BEFORE any field-level validation, and that ordering is the whole
 * point. Every message below it is specific -- which field was undeclared,
 * which operator was unknown -- and a specific message about a source is a
 * statement that the source EXISTS. With the validator running first, a
 * collection the caller may not read answered with detail while an invented
 * name answered generically, and diffing the two walked the install's schema
 * one collection at a time. A supported `count` was worse: it reached
 * execution, where the permission refusal itself confirmed the collection was
 * real.
 *
 * So both dead ends collapse into `failUnavailableSourceOrOp` -- the same
 * string an unknown source gets -- and the reason travels in the log. "You may
 * not use this source" is one answer whether the source is forbidden, not
 * executable, or not there at all.
 *
 * This is the ENDPOINT's gate rather than the domain's, because the decision
 * needs the request-resolved caller. `executeWidgetQuery`'s
 * `overrideAccess: false` remains the enforcement that decides which ROWS come
 * back; this only decides whether the caller is told anything specific.
 */
async function assertSourceReadable(
  source: WidgetSource,
  mayRead: (slug: string) => Promise<boolean>
): Promise<void> {
  if (source.kind !== "collection") {
    failUnavailableSourceOrOp(
      `source "${source.id}" has kind "${source.kind}", which is not executable yet; only collections are`
    );
  }
  const slug = sourceTarget(source.id);
  if (!(await mayRead(slug))) {
    failUnavailableSourceOrOp(
      `caller may not read "${slug}" behind source "${source.id}"`
    );
  }
}

/**
 * One read decision per ENTITY for the whole batch.
 *
 * `canReadEntity` is the same decision `api/dashboard` takes for its own
 * per-entity reads, so a source a widget may name is one that endpoint would
 * already have listed -- and it is deny-by-default, answering false for an
 * unresolvable RBAC service and for an empty caller id.
 *
 * Memoized because the batch runs its queries concurrently and a dashboard
 * asks the same few collections repeatedly: 30 slots naming one collection
 * would otherwise fan out 30 simultaneous permission reads from a cold cache,
 * which is the pathology `auth/entity-read-access`'s own
 * `AUTHORIZATION_CONCURRENCY` exists to bound. The PROMISE is cached rather
 * than its result, so concurrent slots share the one in-flight decision.
 *
 * Per request, never across requests: the verdicts belong to this caller.
 */
function readDecisionsFor(
  caller: ReadCaller
): (slug: string) => Promise<boolean> {
  const accessCaller = readAccessCaller(caller);
  const verdicts = new Map<string, Promise<boolean>>();
  return slug => {
    const pending = verdicts.get(slug);
    if (pending) return pending;
    const verdict = canReadEntity(slug, accessCaller);
    verdicts.set(slug, verdict);
    return verdict;
  };
}

/** One query, read once and resolved to its source, or the slot it failed into. */
type PreparedQuery =
  | {
      ok: true;
      parsed: ReturnType<typeof readWidgetQuery>;
      source: WidgetSource;
    }
  | { ok: false; slot: QuerySlot };

/**
 * What a failure becomes: logged where an operator can read it, redacted where
 * the caller can.
 *
 * Two things this must do that the original catch did neither of.
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
function failedSlot(error: unknown): QuerySlot {
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

/**
 * Reads one caller-supplied query and resolves the source it names, WITHOUT
 * authorizing anything.
 *
 * Split out from running the slot so the batch knows which entities it is
 * about to ask read decisions for BEFORE it starts asking -- which is what
 * lets those decisions be taken in bounded rounds rather than all at once.
 *
 * Every property of the caller's object is read ONCE, here, and the
 * already-read value is what the authorization gate and the validator both
 * work from. Re-reading `source` after authorizing it would let an accessor
 * answer one id to the gate and another to the validator.
 *
 * A failure here is this slot's, not the batch's -- an unparseable entry or an
 * unknown source must not take the other 29 cards down with it.
 */
function prepareOne(raw: unknown): PreparedQuery {
  try {
    const parsed = readWidgetQuery(raw);
    return { ok: true, parsed, source: resolveWidgetSource(parsed.source) };
  } catch (error) {
    return { ok: false, slot: failedSlot(error) };
  }
}

/**
 * The DISTINCT entities this batch will need a read decision about.
 *
 * Only collection sources: `assertSourceReadable` refuses any other kind
 * before it consults `mayRead`, so warming one would take a decision nothing
 * asks for.
 */
function batchSlugs(prepared: readonly PreparedQuery[]): string[] {
  const slugs = new Set<string>();
  for (const entry of prepared) {
    if (entry.ok && entry.source.kind === "collection") {
      slugs.add(sourceTarget(entry.source.id));
    }
  }
  return [...slugs];
}

/**
 * Takes every read decision the batch needs, in the rounds
 * `authorizationGroups` prescribes, before any slot runs.
 *
 * The promise cache below deduplicates REPEATED slugs and does nothing at all
 * for distinct ones, so a legal 30-query batch naming 30 collections opened 30
 * cold permission decisions simultaneously -- reaching the exact fan-out
 * `AUTHORIZATION_CONCURRENCY` exists to bound by going around it.
 * `canReadEntity` resolves a session caller through a shared per-user TTL
 * cache, so firing them together makes every one of them a miss.
 *
 * The grouping is `authorizationGroups`', not a second one written here: it
 * owns both the bound and the lone warm-up round that converts N cold misses
 * into one miss and N-1 hits, and a copy of that reasoning would drift from it.
 *
 * `allSettled`, so a decision that REJECTS still fails only the slots that
 * named it. `Promise.all` would throw out of the warm-up and answer the whole
 * batch with a 500, which is the blast radius the per-slot isolation exists to
 * prevent; the rejected promise stays in the cache and rethrows into each of
 * its own slots.
 */
async function warmReadDecisions(
  slugs: readonly string[],
  mayRead: (slug: string) => Promise<boolean>
): Promise<void> {
  for (const group of authorizationGroups(slugs)) {
    await Promise.allSettled(group.map(mayRead));
  }
}

/** Authorizes, validates and runs one already-prepared query. */
async function runPrepared(
  entry: Extract<PreparedQuery, { ok: true }>,
  caller: ReadCaller,
  mayRead: (slug: string) => Promise<boolean>
): Promise<QuerySlot> {
  try {
    await assertSourceReadable(entry.source, mayRead);

    const query = validateReadWidgetQuery(entry.parsed, entry.source);
    const result = await executeWidgetQuery(query, caller);
    return { ok: true, result };
  } catch (error) {
    return failedSlot(error);
  }
}

export const postWidgetQuery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  // The body is read and checked BEFORE anything touches the database, and the
  // ordering is the point rather than a tidying. The cap is a QUOTA and the
  // shape check is a validity check, so both are preconditions: they run
  // first, whatever they cost. They ran last, behind `refreshCollectionSources`
  // -- a live `getAllCollections()` against `dynamic_collections` -- so an
  // authenticated caller sending a truncated body, no `queries` array, or 40
  // of them bought a registry round trip on every attempt while executing no
  // query at all. Nothing below this point needs the body, and nothing here
  // needs the container.
  //
  // Through `readJsonBody` rather than a bare `req.json()`. A raw
  // `SyntaxError` reaches `withErrorHandler` as an unclassified failure and is
  // wrapped as internal, so a truncated body answered 500 while the body-SHAPE
  // refusals in `parseQueriesBody` answered with the canonical validation
  // envelope -- two refusals about the same request body told two different
  // ways. This is the helper every other body-reading endpoint in this package
  // already uses, so the `invalid_json` code a client branches on is the same
  // one here.
  const body = await readJsonBody(req);
  const queries = parseQueriesBody(body);

  await getCachedNextly();

  // ONCE for the whole batch, before any query is resolved. The collection
  // sources are derived from the live collection registry rather than from the
  // boot config, which is what makes a Schema-Builder collection queryable at
  // all -- it has no config entry, and it can be created while this process is
  // running. See `domains/widgets/collection-sources.ts`.
  await refreshCollectionSources();

  // Resolve the caller ONCE for the whole batch: role-slug resolution is a
  // database read, and doing it per query would make a 20-widget dashboard pay
  // for it 20 times.
  const caller = await readCaller(auth);

  const mayRead = readDecisionsFor(caller);

  // Read and resolve every entry FIRST, so the batch's distinct entities are
  // known before a single read decision is taken -- then take them through the
  // bounded path, and only then run the slots, which now find every decision
  // already made.
  const prepared = queries.map(prepareOne);
  await warmReadDecisions(batchSlugs(prepared), mayRead);

  // An already-failed entry is wrapped rather than handed over bare: a mixed
  // array of values and promises is legal for `Promise.all` and reads as a
  // mistake, so the aggregator is given one kind.
  const results: QuerySlot[] = await Promise.all(
    prepared.map(entry =>
      entry.ok
        ? runPrepared(entry, caller, mayRead)
        : Promise.resolve(entry.slot)
    )
  );

  return respondData({ results }, { headers: PRIVATE_NO_STORE_HEADERS });
});
