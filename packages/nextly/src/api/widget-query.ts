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
import { MAX_QUERIES_PER_REQUEST } from "../domains/widgets/batch-limit";
import { createBatchScope } from "../domains/widgets/batch-scope";
import { refreshContentSources } from "../domains/widgets/collection-widgets";
import {
  entityRead,
  resolveExecutableSource,
  type ExecutableSource,
} from "../domains/widgets/executable-source";
import {
  readWidgetQuery,
  resolveWidgetSource,
  validateReadWidgetQuery,
} from "../domains/widgets/query";
import type { WidgetSlot } from "../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  sourceTarget,
} from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { readAccessCaller, readCaller } from "./authenticated-read";
import { readJsonBody } from "./read-json-body";
import { respondData } from "./response-shapes";
import {
  answerReadyQueries,
  failedSlot,
  type ReadyQuery,
} from "./widget-slots";
import { withErrorHandler } from "./with-error-handler";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

/*
 * 🔴 The wire type the DOMAIN declares, not a second one shaped here. The
 * loose local interface this replaces said `ok: boolean` with an optional
 * `result?: unknown` and an optional `error?: string`, so nothing stopped a
 * slot claiming success while carrying nothing, and nothing recorded that a
 * successful slot's `result` is a `WidgetResult` -- which the admin's own copy
 * of this type had always promised its readers. Both construction sites below
 * already produced the strict shape; naming it is what makes the compiler keep
 * them that way, and what lets one definition be published to the consumers
 * that were each declaring their own.
 */
type QuerySlot = WidgetSlot;

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
 *
 * ## Why a SYSTEM source passes without a read decision
 *
 * 🔴 Not an omission. A system source's rows are not an entity the permission
 * table names -- a release is not a row in a collection, and a translation gap
 * is a relationship BETWEEN rows -- so there is no slug to put to
 * `canReadEntity`. Its authorization lives in the service that owns those rows,
 * and `executeWidgetQuery` hands that service THIS caller:
 * `ReleasesService.find` asks its own `authorize` before it reads. A check
 * invented here would be a second implementation of a rule this module cannot
 * see, coarser than the one it shadows, agreeing on the day it is written and
 * drifting afterwards -- which is precisely what `WidgetSource`'s
 * `requiredPermission` docblock refuses for the same reason, and what Strapi's
 * homepage widgets got wrong (strapi#22921).
 *
 * The anti-enumeration property above survives this, because it was never about
 * source ids as such. A `collection:` id carries an author-defined slug, so
 * walking the refusals maps the install's content schema. The `system:`
 * namespace is core's (`RESERVED_NAMESPACE_KINDS`), its ids are the same fixed,
 * documented set in every install, and its refusals are the domain's own:
 * `NextlyError.forbidden` publishes a fixed sentence naming neither the
 * resource nor the missing authority, and the same answer is already reachable
 * through that domain's REST route by any authenticated caller. So admitting
 * these sources tells a caller nothing a collection refusal was protecting.
 *
 * 🔴 WHICH sources this gate applies to is the executor's decision, carried in
 * the `ExecutableSource` that `prepareOne` resolved, and never restated here.
 * The gate once listed the kinds it would admit, and the list drifted from the
 * executor's: `single` became executable in the domain while this endpoint --
 * the only production caller -- went on refusing every `single:` query as "not
 * executable yet". `entityRead` answers per kind, exhaustively, so a kind the
 * executor learns to run is gated here the day it is added.
 */
async function assertSourceReadable(
  executable: ExecutableSource,
  mayRead: (slug: string) => Promise<boolean>
): Promise<void> {
  const slug = entityRead(executable);
  if (slug === undefined) return;
  if (!(await mayRead(slug))) {
    failUnavailableSourceOrOp(
      `caller may not read "${slug}" behind source "${executable.source.id}"`
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
      executable: ExecutableSource;
    }
  | {
      ok: false;
      slot: QuerySlot;
      /** The entity an unresolvable source would have been read as; see `decoyRead`. */
      decoy?: string;
    };

/**
 * The entity a source that could not be resolved would have needed a read decision about, so
 * the batch takes one for it all the same.
 *
 * 🔴 The answer was already the same for a forbidden source and an unknown one; the WORK was
 * not. A collection the caller may not read cost a permission decision before it was refused,
 * and an invented name was refused at once, so how long a batch took said which of its names
 * were real. Taking the decision for the invented name too -- in the same bounded rounds, through
 * the same memo -- makes the two paths take the same steps, and its verdict is thrown away: the
 * slot has already failed. Timing is not asserted anywhere, because a test of it would be flaky;
 * what is asserted is that both paths ask.
 *
 * What this does NOT make equal is the decision's own cost. A collection with a code-defined read
 * rule runs that rule, and a rule may do slow work; an invented name has no rule to run. So a
 * slow rule can still show in a batch's timing which names are real. Closing that would mean
 * padding every answer to a fixed cost, which no other read path in the API does either.
 *
 * Only for the two kinds that are read as an entity. A `system:` or `plugin:` source takes no
 * read decision when it exists either, so asking one for it here would make it the odd one out.
 */
function decoyRead(source: unknown): string | undefined {
  if (typeof source !== "string") return undefined;
  const kind = source.slice(0, source.indexOf(":"));
  if (kind !== "collection" && kind !== "single") return undefined;
  return sourceTarget(source) || undefined;
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
  // Kept outside the `try` so a source that fails to resolve can still name its decoy.
  let named: unknown;
  try {
    const parsed = readWidgetQuery(raw);
    named = parsed.source;
    const source = resolveWidgetSource(parsed.source);
    // 🔴 Whether anything EXECUTES the source is decided here, before a read
    // decision is taken or a field is validated, by the executor's own
    // resolution rather than by the kind alone. A resolver-less system source
    // registered through the generic `registerSource` door once reached
    // field-level validation, where every message is specific: an undeclared
    // `select` was answered ON that source while an invented id got the
    // generic sentence, so the pair distinguished a registered system source
    // from a nonexistent one -- the enumeration oracle the gate exists to
    // close. Every refusal below is the one shared sentence.
    return { ok: true, parsed, executable: resolveExecutableSource(source.id) };
  } catch (error) {
    const slot = failedSlot(error);
    return slot.code === "unavailable"
      ? { ok: false, slot, decoy: decoyRead(named) }
      : { ok: false, slot };
  }
}

/**
 * The DISTINCT entities this batch will need a read decision about.
 *
 * Exactly the sources `assertSourceReadable` will put to `mayRead`, by the
 * same `entityRead` -- a collection's slug and a single's alike, and nothing
 * for a system source, whose authorization belongs to the service that owns
 * its rows. Collected by a second spelling of that rule, this once named the
 * collections alone, so a batch of singles would have started every one of
 * its cold decisions at once from the slots, around the bound.
 */
function batchSlugs(prepared: readonly PreparedQuery[]): string[] {
  const slugs = new Set<string>();
  for (const entry of prepared) {
    // A source that failed to resolve is asked about as well, so it costs what a real one does.
    const slug = entry.ok ? entityRead(entry.executable) : entry.decoy;
    if (slug !== undefined) slugs.add(slug);
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

/** Runs one prepared query's preconditions: the caller may read its source, and it is valid. */
async function checkPrepared(
  entry: Extract<PreparedQuery, { ok: true }>,
  index: number,
  mayRead: (slug: string) => Promise<boolean>
): Promise<ReadyQuery | QuerySlot> {
  try {
    await assertSourceReadable(entry.executable, mayRead);
    const query = validateReadWidgetQuery(
      entry.parsed,
      entry.executable.source
    );
    return { index, query, executable: entry.executable };
  } catch (error) {
    return failedSlot(error);
  }
}

function isReady(entry: ReadyQuery | QuerySlot): entry is ReadyQuery {
  return "query" in entry;
}

/**
 * A ready query the runner returned no slot for. The runner answers every query
 * it is handed, so this is a guard over a value already in hand that costs nothing
 * while it never runs, and turns a lost slot into a failed one rather than a hole
 * in the response.
 */
function unanswered(): QuerySlot {
  return failedSlot(
    NextlyError.internal({
      logContext: { reason: "widget-slot-unanswered" },
    })
  );
}

export const postWidgetQuery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  // The body is read and checked BEFORE anything touches the database, and the
  // ordering is the point rather than a tidying. The cap is a QUOTA and the
  // shape check is a validity check, so both are preconditions: they run
  // first, whatever they cost. They ran last, behind the source refresh -- a
  // live `getAllCollections()` against `dynamic_collections` -- so an
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

  // ONCE for the whole batch, before any query is resolved, and BOTH kinds of
  // content source. They are derived from the live registries rather than
  // from the boot config, which is what makes a Schema-Builder collection
  // queryable at all -- it has no config entry, and it can be created while
  // this process is running. See `domains/widgets/collection-sources.ts`.
  await refreshContentSources();

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

  // Every query's own checks first -- the caller may read its source, and the
  // query is valid for it -- since these are preconditions. Only the queries that
  // pass are run, and they run through ONE path: grouped by source, with work
  // shared within this batch for this caller and nowhere else.
  const checked = await Promise.all(
    prepared.map((entry, index) =>
      entry.ok
        ? checkPrepared(entry, index, mayRead)
        : Promise.resolve(entry.slot)
    )
  );
  const answered = await answerReadyQueries(
    checked.filter(isReady),
    caller,
    createBatchScope()
  );
  const results: QuerySlot[] = checked.map((entry, index) =>
    isReady(entry) ? (answered.get(index) ?? unanswered()) : entry
  );

  return respondData({ results }, { headers: PRIVATE_NO_STORE_HEADERS });
});
