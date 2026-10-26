/**
 * The Get started steps this reader is offered, and how far through them they
 * are, decided on the server.
 *
 * A step is DETECTED, never self-reported, and offered only to someone who
 * could finish it: a step a reader cannot complete is an offer that lands on a
 * surface that refuses them. Four kinds, in order: create a collection, add a
 * first entry, fill in each Single, and invite a teammate.
 *
 * "Not known" is its own answer throughout. A registry that cannot be listed,
 * a count that ran out of time, a check that failed: each is reported as such,
 * never as "done" and never as "waiting", because both would tell the reader
 * something nobody found out.
 *
 * @module domains/widgets/get-started
 */

import { callerMayPerform } from "../../auth/access/route-gate-adapters";
import { authorizationGroups } from "../../auth/entity-read-access";
import { getService } from "../../di";
import { isBuilderEnabled } from "../../shared/builder-access";

import type { ConditionProbe, RegistryAnswer } from "./condition-probe";
import {
  GET_STARTED_SKIPPABLE_KINDS,
  type GetStartedAnswer,
  type GetStartedStep,
  type GetStartedStepKind,
  type GetStartedStepStatus,
} from "./get-started-steps";
import { CONTENT_CHECK_BUDGET_MS, queryableSlugs } from "./reader-content";

/** At most this many Singles' stored documents are read at once by the fallback. */
const FALLBACK_CONCURRENCY = 8;

function step(
  kind: GetStartedStepKind,
  status: GetStartedStepStatus,
  single?: string
): GetStartedStep {
  return {
    key: single === undefined ? kind : `single:${single}`,
    kind,
    status,
    ...(single === undefined ? {} : { single }),
  };
}

/**
 * "Create a collection": done once the reader can read one, offered otherwise
 * only where the schema builder is on, to a reader who could create one and
 * read it afterwards.
 */
async function collectionStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<GetStartedStep | undefined> {
  const read = await probe.collectionsRead();
  if (read.reachable && read.slugs.length > 0) {
    return step("collection", "done");
  }
  signal.throwIfAborted();
  // 🔴 The step's action is the builder. Where it is off (production, unless
  // the host turns it on) creating a collection is refused whoever asks, so
  // the step is not offered: collections come from code there.
  if (!isBuilderEnabled()) return undefined;
  if (!(await probe.mayCreateCollection())) return undefined;
  // Unlisted, the step is not known: never "waiting" on the strength of a
  // registry that could not answer.
  return step("collection", read.reachable ? "open" : "unknown");
}

/**
 * "Add your first entry": done once the reader can see a collection entry.
 * Only collection entries count: a saved Single is a Single's own step.
 */
async function entryStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<GetStartedStep | undefined> {
  const content = await probe.hasContent();
  if (content === true) return step("entry", "done");
  signal.throwIfAborted();
  // Waiting or not known, the step is still an offer to add an entry, so only
  // a reader who could add one is given it.
  if (!(await probe.mayCreateEntry())) return undefined;
  return step("entry", content === "unknown" ? "unknown" : "open");
}

/**
 * Of `singles`, the ones this reader may update, in the order given.
 *
 * Decided per Single through {@link callerMayPerform}, as a write is, and in
 * {@link authorizationGroups} order so a cold per-user cache is filled once.
 * A decision that threw has told us nothing, and a step is offered only to
 * someone who could finish it, so its Single is "unknown" here and the answer
 * that offers it is not known as a whole. No group is started after `signal`
 * fires: its answer would be thrown away.
 */
async function updatableSingles(
  probe: ConditionProbe,
  singles: readonly string[],
  signal: AbortSignal
): Promise<Map<string, boolean | "unknown">> {
  const { caller } = probe;
  const decided = new Map<string, boolean | "unknown">();
  for (const group of authorizationGroups(singles)) {
    signal.throwIfAborted();
    const settled = await Promise.allSettled(
      group.map(slug =>
        callerMayPerform(caller.authenticatedScope, "update", slug, caller.user)
      )
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      decided.set(
        slug,
        outcome?.status === "fulfilled" ? outcome.value : "unknown"
      );
    });
  }
  return decided;
}

/** A stored Single's two instants, as its table holds them. */
interface StoredInstants {
  created_at?: unknown;
  updated_at?: unknown;
}

/**
 * Whether a stored document was written after it was created: the record a
 * Single's save leaves when the trail predates it.
 *
 * Strictly later. A Single's document is created with both instants equal, so
 * equality means it was never saved since; and a save in the same second as
 * the creation is the trail's to report, which is why the trail is asked first.
 *
 * A known limit, kept deliberately: on MySQL and SQLite, which store whole
 * seconds, a Single first saved in the second it was created has equal
 * instants, so only the trail knows of that save. Once retention prunes the
 * trail row (`audit.retention.activityMaxAgeMs`, 90 days by default) the step
 * reads as waiting again. It errs toward reopening a skippable step, never
 * toward ticking one nobody finished; a record that outlived retention would be
 * new stored state for one narrow case.
 */
export function writtenSinceCreated(row: StoredInstants): boolean {
  return (
    row.created_at instanceof Date &&
    row.updated_at instanceof Date &&
    row.updated_at.getTime() > row.created_at.getTime()
  );
}

/**
 * Whether one Single's stored document was written after it was created. Its
 * second read is not started once `signal` has fired.
 */
async function singleChangedSinceCreated(
  slug: string,
  signal: AbortSignal
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const single = await registry.getSingleBySlug(slug);
  if (!single) return false;
  signal.throwIfAborted();
  const row = await getService("adapter").selectOne<StoredInstants>(
    single.tableName,
    { columns: ["created_at", "updated_at"] }
  );
  return row ? writtenSinceCreated(row) : false;
}

/**
 * Each of `slugs` answered by `answer`, at most `limit` at once, inside
 * `budgetMs`: a slug not answered by then, or whose answer failed, is
 * "unknown". Once `signal` fires no further slug is started, and the answers
 * end there.
 */
export function answeredWithin<T>(
  slugs: readonly string[],
  answer: (slug: string) => Promise<T>,
  limit: number = FALLBACK_CONCURRENCY,
  budgetMs: number = CONTENT_CHECK_BUDGET_MS,
  signal?: AbortSignal
): Promise<Map<string, T | "unknown">> {
  const answers = new Map<string, T | "unknown">();
  if (slugs.length === 0) return Promise.resolve(answers);
  return new Promise(resolve => {
    let next = 0;
    let inFlight = 0;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      for (const slug of slugs) {
        if (!answers.has(slug)) answers.set(slug, "unknown");
      }
      resolve(answers);
    };
    const timer = setTimeout(end, budgetMs);
    // A check that answered in a millisecond must not hold the process open for the rest of its budget.
    timer.unref?.();
    signal?.addEventListener("abort", end, { once: true });
    const launch = (): void => {
      while (!ended && inFlight < limit && next < slugs.length) {
        const slug = slugs[next];
        next += 1;
        if (slug === undefined) continue;
        inFlight += 1;
        Promise.resolve()
          .then(() => answer(slug))
          .then(
            value => answers.set(slug, value),
            () => answers.set(slug, "unknown")
          )
          .finally(() => {
            inFlight -= 1;
            launch();
          });
      }
      if (inFlight === 0 && next >= slugs.length) end();
    };
    launch();
  });
}

/**
 * "Fill in <Single>", one step per Single the reader may update, in the
 * registry's order.
 *
 * Done when the trail has recorded a save of it, asked for every Single in one
 * query. A Single saved only before the trail recorded saves still counts when
 * its stored document was written after it was created; with neither, the step
 * is waiting. Never counted as content: filling in a Single is not adding an
 * entry.
 */
async function singleSteps(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<GetStartedStep[] | undefined> {
  const read = await probe.singlesRead();
  // Unlisted, there is nothing to offer step by step; the answer says so as a whole.
  if (!read.reachable) return [];
  const updatable = await updatableSingles(probe, read.slugs, signal);
  // A Single whose permission could not be decided cannot be offered: nobody
  // knows whether this reader could fill it in. The answer is then not known as
  // a whole, which is what `undefined` says, rather than a step that may be an
  // offer the reader cannot take.
  if ([...updatable.values()].includes("unknown")) return undefined;
  const offered = read.slugs.filter(slug => updatable.get(slug) === true);
  if (offered.length === 0) return [];

  signal.throwIfAborted();
  let saved: ReadonlySet<string>;
  try {
    // Counted from when each Single was registered, so a Single deleted and
    // made again is not ticked by its predecessor's saves.
    saved =
      await getService("activityLogService").singlesWithRecordedSaves(offered);
  } catch {
    return offered.map(slug => step("single", "unknown", slug));
  }
  // The fallback reads a Single's own table, so only those whose table is known
  // to match their stored shape; any other is not known.
  const queryable = new Set(queryableSlugs("single", offered));
  const fallback = await answeredWithin(
    offered.filter(slug => !saved.has(slug) && queryable.has(slug)),
    slug => singleChangedSinceCreated(slug, signal),
    FALLBACK_CONCURRENCY,
    CONTENT_CHECK_BUDGET_MS,
    signal
  );
  return offered.map(slug => {
    if (saved.has(slug)) return step("single", "done", slug);
    const changed = fallback.get(slug);
    if (changed === undefined || changed === "unknown") {
      return step("single", "unknown", slug);
    }
    return step("single", changed ? "done" : "open", slug);
  });
}

/**
 * "Invite a teammate": done once the install has a second account, which an
 * invitation creates as it is sent, so a pending invitation counts. Offered
 * only to someone who may both create and read users, which is also why an
 * install-wide count is no disclosure here.
 */
async function inviteStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<GetStartedStep | undefined> {
  const { caller } = probe;
  const [mayCreate, mayRead] = await Promise.all([
    callerMayPerform(caller.authenticatedScope, "create", "users", caller.user),
    callerMayPerform(caller.authenticatedScope, "read", "users", caller.user),
  ]);
  if (!mayCreate || !mayRead) return undefined;
  signal.throwIfAborted();
  // Two rows say "more than one account"; reading more would say nothing more.
  const accounts = await getService("adapter").select<{ id: string }>("users", {
    columns: ["id"],
    limit: 2,
  });
  return step("invite", accounts.length > 1 ? "done" : "open");
}

/**
 * What a branch answers when its own check failed or ran out of time: no step,
 * and the answer not known as a whole.
 *
 * Not a step marked "unknown": that check is also what decides whether the step
 * is offered at all, so offering one would hand a reader who may not be able to
 * finish it an action and its link. The card says instead that it could not
 * check setup, and offers Retry.
 */
const FELL_BACK = Symbol("fell back");
type FellBack = typeof FELL_BACK;
const fellBack = (): FellBack => FELL_BACK;

/** The registry read a deadline left unanswered: not listed. */
function unlisted(): RegistryAnswer {
  return { slugs: [], reachable: false };
}

/**
 * Every step this reader is offered, with what each says, before any of the
 * reader's skips.
 *
 * The four kinds are asked together, so the slowest bounds the answer rather
 * than their sum, and the whole answer is held to one deadline: the layout
 * read waits on it, so a stalled permission check, trail query or users read
 * must not stall the dashboard. A branch that has not answered by `budgetMs`,
 * or whose check failed, offers nothing and makes the whole answer not known,
 * as an unlisted registry does.
 *
 * The deadline also stops the work, not only the wait: the branches are handed
 * its signal, and none starts another read once it has fired: no further
 * authorization group, trail query, stored-document read or users read. A read
 * already running cannot be cancelled; it finishes, and its answer is ignored.
 */
export async function getStartedSteps(
  probe: ConditionProbe,
  budgetMs: number = CONTENT_CHECK_BUDGET_MS
): Promise<GetStartedAnswer> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => {
      stop.abort();
      resolve();
    }, budgetMs);
    // An answer reached in a millisecond must not hold the process open for the rest of the budget.
    timer.unref?.();
  });
  const byDeadline = <T>(work: Promise<T>, late: () => T): Promise<T> =>
    Promise.race([work, deadline.then(late)]);
  const branch = <T>(work: Promise<T>): Promise<T | FellBack> =>
    byDeadline(work.catch(fellBack), fellBack);
  try {
    const [collections, singles, collection, entry, perSingle, invite] =
      await Promise.all([
        byDeadline(probe.collectionsRead(), unlisted),
        byDeadline(probe.singlesRead(), unlisted),
        branch(collectionStep(probe, stop.signal)),
        branch(entryStep(probe, stop.signal)),
        // `undefined` when the Singles' steps could not be worked out at all.
        branch(singleSteps(probe, stop.signal)),
        branch(inviteStep(probe, stop.signal)),
      ]);
    const fellShort = [collection, entry, perSingle, invite].some(
      answered => answered === FELL_BACK
    );
    const steps = [
      collection,
      entry,
      ...(Array.isArray(perSingle) ? perSingle : []),
      invite,
    ].filter(
      (offered): offered is GetStartedStep =>
        offered !== undefined && offered !== FELL_BACK
    );
    return tallied(
      !collections.reachable ||
        !singles.reachable ||
        fellShort ||
        perSingle === undefined,
      steps
    );
  } finally {
    clearTimeout(timer);
  }
}

function tallied(unknown: boolean, steps: GetStartedStep[]): GetStartedAnswer {
  return {
    unknown,
    steps,
    done: steps.filter(
      offered => offered.status === "done" || offered.status === "skipped"
    ).length,
    total: steps.length,
  };
}

/** The kinds a reader may skip, from the published list the card offers Skip by. */
const SKIPPABLE: ReadonlySet<GetStartedStepKind> = new Set(
  GET_STARTED_SKIPPABLE_KINDS
);

/**
 * The step keys a placement's settings record as skipped. Anything else in
 * them, or a value that is not a list of keys, is ignored.
 */
export function skippedSteps(config: unknown): ReadonlySet<string> {
  if (typeof config !== "object" || config === null) return new Set();
  const skipped = (config as { skipped?: unknown }).skipped;
  if (!Array.isArray(skipped)) return new Set();
  return new Set(
    skipped.filter((key): key is string => typeof key === "string")
  );
}

/**
 * The answer with this reader's skips applied: a waiting step they skipped
 * reads as skipped, which "x of y done" counts as done. Only a waiting step of
 * a skippable kind: a step already done stays done, one not known stays not
 * known, and creating a collection or a first entry is not skippable.
 */
export function withSkips(
  answer: GetStartedAnswer,
  skipped: ReadonlySet<string>
): GetStartedAnswer {
  if (skipped.size === 0) return answer;
  return tallied(
    answer.unknown,
    answer.steps.map(offered =>
      offered.status === "open" &&
      SKIPPABLE.has(offered.kind) &&
      skipped.has(offered.key)
        ? { ...offered, status: "skipped" as const }
        : offered
    )
  );
}
