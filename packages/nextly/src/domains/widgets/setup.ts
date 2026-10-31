/**
 * The setup steps this reader is offered, and how far through them they are,
 * decided on the server from the site's state.
 *
 * A step is DETECTED, never self-reported, and offered only to someone who
 * could finish it: a step a reader cannot complete is an offer that lands on a
 * surface that refuses them. Five kinds, in order: start with sample content,
 * create a collection, add a first entry, fill in the Singles (one step for
 * all of them) and invite a teammate.
 *
 * "Not known" is an answer of its own, and it is the answer's as a whole: a
 * registry that cannot be listed, a count that ran out of time, a check that
 * failed. The card then says it could not check setup and offers Retry, so no
 * step is ever drawn as waiting on a guess.
 *
 * @module domains/widgets/setup
 */

import { callerMayPerform } from "../../auth/access/route-gate-adapters";
import { authorizationGroups } from "../../auth/entity-read-access";
import { getService } from "../../di";
import { isBuilderEnabled } from "../../shared/builder-access";

import type { ConditionProbe } from "./condition-probe";
import {
  CONTENT_CHECK_BUDGET_MS,
  queryableSlugs,
  updateVerdict,
} from "./reader-content";
import {
  isSkippableKind,
  talliedSetup,
  type SetupAnswer,
  type SetupSingle,
  type SetupStep,
  type SkippableSetupStepKind,
} from "./setup-steps";

/** At most this many Singles' stored documents are read at once by the fallback. */
const FALLBACK_CONCURRENCY = 8;

/**
 * What a step's rule answers when its own check could not be made: no step,
 * and the whole answer not known. Not a step marked "waiting": that check is
 * also what decides whether the step is offered at all.
 */
const NOT_KNOWN = Symbol("not known");
type NotKnown = typeof NOT_KNOWN;

/** A step's rule: the step, `undefined` when it is not offered, or not known. */
type StepAnswer = SetupStep | undefined | NotKnown;

/**
 * "Start with sample content": done once anyone loaded or declined it, which
 * is recorded for the whole site. Open only while nobody has answered and the
 * site holds no entry (`dashboard-layout` R-18), so an established site is not
 * offered it. When the site's answer cannot be read, setup is not known as a
 * whole, as for every other check: dropping the step instead could let the
 * remaining steps finish setup and retire the card for good over an outage.
 *
 * Whether the project provides the route, and whether it would let this
 * reader load, only the route can say: the admin asks it, and drops the step
 * when it refuses.
 */
async function sampleStep(probe: ConditionProbe): Promise<StepAnswer> {
  let answered: boolean;
  try {
    answered = await probe.sampleAnswered();
  } catch {
    return NOT_KNOWN;
  }
  if (answered) return { kind: "sample", status: "done" };
  const content = await probe.hasContent();
  if (content === "unknown") return NOT_KNOWN;
  return content ? undefined : { kind: "sample", status: "open" };
}

/**
 * "Create a collection": done once the reader can read one, and offered while
 * there is none only where the schema builder is on, to a reader who could
 * create one and read it afterwards.
 */
async function collectionStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<StepAnswer> {
  const read = await probe.collectionsRead();
  if (!read.reachable) return NOT_KNOWN;
  if (read.slugs.length > 0) return { kind: "collection", status: "done" };
  signal.throwIfAborted();
  // 🔴 The step's action is the builder. Where it is off (production, unless
  // the host turns it on) creating a collection is refused whoever asks, so
  // the step is not offered: collections come from code there.
  if (!isBuilderEnabled()) return undefined;
  if (!(await probe.mayCreateCollection())) return undefined;
  return { kind: "collection", status: "open" };
}

/**
 * "Add your first entry": done once any collection the reader may read holds
 * an entry. Only collection entries count: a saved Single is the Singles
 * step's. Open, it names the first collection the reader may create in, so
 * the step opens a new entry there rather than the collections index; a
 * reader who may create in none is not offered it.
 */
async function entryStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<StepAnswer> {
  const content = await probe.hasContent();
  if (content === "unknown") return NOT_KNOWN;
  if (content) return { kind: "entry", status: "done" };
  signal.throwIfAborted();
  const collection = await probe.firstCreatableCollection();
  if (collection === undefined) return undefined;
  return { kind: "entry", status: "open", collection };
}

/**
 * Of `singles`, the ones this reader may update, in the order given.
 *
 * Decided per Single as its editor's save is ({@link updateVerdict}), in the
 * default language that save is judged in, in {@link authorizationGroups} order so a
 * cold per-user cache is filled once. A decision that threw has told us
 * nothing, so its Single is "unknown", and the step that would offer it is not
 * known as a whole. No group starts after `signal` fires.
 */
async function updatableSingles(
  probe: ConditionProbe,
  singles: readonly string[],
  signal: AbortSignal
): Promise<Map<string, boolean | "unknown">> {
  // The decision the Single's own editor saves under, in the language that
  // save is judged in (`updateVerdict`), so a rule that answers by language
  // offers the step exactly where the save is allowed.
  const mayUpdate = updateVerdict(probe.caller);
  const decided = new Map<string, boolean | "unknown">();
  for (const group of authorizationGroups(singles)) {
    signal.throwIfAborted();
    const settled = await Promise.allSettled(group.map(mayUpdate));
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
 * Single's save leaves when the activity trail predates it
 * (`dashboard-layout` R-17).
 *
 * Strictly later. A Single's document is created with both instants equal, so
 * equality means it was never saved since; and a save in the same second as
 * the creation is the trail's to report, which is why the trail is asked first.
 *
 * A known limit, kept deliberately: on MySQL and SQLite, which store whole
 * seconds, a Single first saved in the second it was created has equal
 * instants, so only the trail knows of that save. Once retention prunes the
 * trail row the Single reads as not filled in again. It errs toward reopening
 * a skippable step, never toward ticking one nobody finished.
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
 * Each offered Single, filled in when the trail recorded a save of it or its
 * stored document was written since it was made (`fallback`); not known as a
 * whole when any Single the trail has no save of was not answered.
 */
function singlesAsAnswered(
  offered: readonly string[],
  saved: ReadonlySet<string>,
  fallback: ReadonlyMap<string, boolean | "unknown">
): SetupSingle[] | NotKnown {
  const singles: SetupSingle[] = [];
  for (const slug of offered) {
    const filledIn = saved.has(slug) || fallback.get(slug);
    if (filledIn === undefined || filledIn === "unknown") return NOT_KNOWN;
    singles.push({ slug, filledIn });
  }
  return singles;
}

/**
 * "Fill in your Singles": ONE step for every Single the reader may edit, in
 * the registry's order, done when every one of them has been saved.
 *
 * A Single counts as saved when the activity trail recorded a save of it,
 * asked for every Single in one query; one saved only before the trail
 * recorded saves still counts when its stored document was written after it
 * was created. A Single whose permission or save could not be decided makes
 * the step, and so the answer, not known.
 */
async function singlesStep(
  probe: ConditionProbe,
  signal: AbortSignal
): Promise<StepAnswer> {
  const read = await probe.singlesRead();
  if (!read.reachable) return NOT_KNOWN;
  const updatable = await updatableSingles(probe, read.slugs, signal);
  if ([...updatable.values()].includes("unknown")) return NOT_KNOWN;
  const offered = read.slugs.filter(slug => updatable.get(slug) === true);
  if (offered.length === 0) return undefined;

  signal.throwIfAborted();
  let saved: ReadonlySet<string>;
  try {
    // Counted from when each Single was registered, so a Single deleted and
    // made again is not ticked by its predecessor's saves.
    saved =
      await getService("activityLogService").singlesWithRecordedSaves(offered);
  } catch {
    return NOT_KNOWN;
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
  const singles = singlesAsAnswered(offered, saved, fallback);
  if (singles === NOT_KNOWN) return NOT_KNOWN;
  return {
    kind: "singles",
    status: singles.every(single => single.filledIn) ? "done" : "open",
    singles,
  };
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
): Promise<StepAnswer> {
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
  return { kind: "invite", status: accounts.length > 1 ? "done" : "open" };
}

/**
 * Every step this reader is offered, in order, with what each says, before any
 * of the reader's skips; or not known.
 *
 * The five rules are asked together, so the slowest bounds the answer rather
 * than their sum, and the whole answer is held to one deadline: a rule that has
 * not answered by `budgetMs`, or whose check threw, makes the whole answer not
 * known. The deadline also stops the work: the rules are handed its signal, and
 * none starts another read once it has fired. A read already running finishes,
 * and its answer is ignored.
 */
export async function setupSteps(
  probe: ConditionProbe,
  budgetMs: number = CONTENT_CHECK_BUDGET_MS
): Promise<SetupAnswer> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<NotKnown>(resolve => {
    timer = setTimeout(() => {
      stop.abort();
      resolve(NOT_KNOWN);
    }, budgetMs);
    // An answer reached in a millisecond must not hold the process open for the rest of the budget.
    timer.unref?.();
  });
  const bounded = (work: Promise<StepAnswer>): Promise<StepAnswer> =>
    Promise.race([work.catch((): NotKnown => NOT_KNOWN), deadline]);
  try {
    const answers = await Promise.all([
      bounded(sampleStep(probe)),
      bounded(collectionStep(probe, stop.signal)),
      bounded(entryStep(probe, stop.signal)),
      bounded(singlesStep(probe, stop.signal)),
      bounded(inviteStep(probe, stop.signal)),
    ]);
    if (answers.includes(NOT_KNOWN)) return { known: false };
    return talliedSetup(
      answers.filter(
        (offered): offered is SetupStep =>
          offered !== undefined && offered !== NOT_KNOWN
      )
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The answer with this reader's skips applied: an open step of a skippable
 * kind that they skipped reads as skipped, which "N of M done" counts as done.
 * A step already done stays done, and an answer not known stays not known.
 */
export function withSkips(
  answer: SetupAnswer,
  skipped: ReadonlySet<SkippableSetupStepKind>
): SetupAnswer {
  if (!answer.known || skipped.size === 0) return answer;
  return talliedSetup(
    answer.steps.map(step =>
      step.status === "open" &&
      isSkippableKind(step.kind) &&
      skipped.has(step.kind)
        ? { ...step, status: "skipped" as const }
        : step
    )
  );
}
