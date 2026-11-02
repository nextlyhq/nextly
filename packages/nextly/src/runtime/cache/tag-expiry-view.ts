/**
 * What nextly's cache handlers know about expired tags, shared by both
 * handlers and every module copy in one process.
 *
 * Next.js loads a cache handler from its file path, outside the app's bundle,
 * and nextly runs as a server external, so the handlers and the app share this
 * module's state through `globalThis`. nextly publishes its ledger here when it
 * registers; until it does, the handlers keep only what this process expired
 * itself, which is all a single instance needs.
 *
 * Before an entry is served, the expiries of the tags it carries are asked of
 * the ledger by key. Each tag's answer is kept for `TAG_LOOKUP_TTL_MS` and
 * reused by every read in that time, and a tag already being asked about is
 * not asked again, so a busy instance reads the ledger a bounded number of
 * times a minute per tag it serves. A write recorded anywhere is therefore
 * seen by every instance within the TTL and one request.
 *
 * @module runtime/cache/tag-expiry-view
 */
import { getNextlyLogger } from "../../observability/logger";

import {
  LEDGER_RETENTION_MS,
  TAG_EXPIRY_GRACE_MS,
  type TagExpiryLedger,
} from "./tag-expiry-ledger";

/** How long a tag's answer from the ledger is reused before it is asked again. */
export const TAG_LOOKUP_TTL_MS = 5_000;

/**
 * The longest a ledger call is waited for. A database that takes connections
 * but never answers would otherwise hold every cached read that asks it, and
 * every write's record, for as long as it stays that way.
 */
export const LEDGER_CALL_TIMEOUT_MS = 5_000;

/** What {@link withinLedgerBound} gives for a call that did not answer in time. */
const NO_ANSWER = Symbol("no ledger answer");

/** The two kinds of ledger call, each bounded on its own. */
type LedgerCall = "record" | "lookup";

/**
 * How many ledger calls of one kind run at once. A call given up on is not
 * cancelled and keeps its connection until the database answers, so this is
 * also the most connections a database that never answers can hold through
 * the ledger, per kind and process: the rest wait for a slot, within the same
 * bound, or are turned away.
 */
export const MAX_LEDGER_CALLS_IN_FLIGHT = 4;

/** What {@link withinLedgerBound} gives for a call it did not start. */
const TURNED_AWAY = Symbol("ledger call not started");

/**
 * The calls one published ledger has under way, by kind: those running,
 * those given up on and still running, and those waiting for a slot. Kept per
 * ledger, so a call of a withdrawn one, stuck for good, cannot hold back the
 * ledger installed after it.
 */
interface LedgerCalls {
  running: Record<LedgerCall, number>;
  stuck: Record<LedgerCall, number>;
  waiting: Record<LedgerCall, (() => void)[]>;
  /**
   * Set once another ledger is published: no call waiting here starts after
   * that, since it would write to or read from the withdrawn ledger.
   */
  closed: boolean;
}

function noLedgerCalls(): LedgerCalls {
  return {
    running: { record: 0, lookup: 0 },
    stuck: { record: 0, lookup: 0 },
    waiting: { record: [], lookup: [] },
    closed: false,
  };
}

/**
 * Closes the withdrawn ledger's calls and wakes every call waiting for one of
 * its slots, which then turns itself away rather than waiting out its bound.
 * Calls already running end against these counts, which nothing reads again.
 */
function closeLedgerCalls(calls: LedgerCalls): void {
  calls.closed = true;
  for (const kind of ["record", "lookup"] as const) {
    const waiting = calls.waiting[kind];
    calls.waiting[kind] = [];
    for (const wake of waiting) wake();
  }
}

/**
 * The answer of the call `start` makes, or {@link NO_ANSWER} once
 * {@link LEDGER_CALL_TIMEOUT_MS} passes without one, or {@link TURNED_AWAY}
 * when it is not started. The wait is bounded, the query is not: it goes on
 * holding its connection. So at most {@link MAX_LEDGER_CALLS_IN_FLIGHT} of a
 * kind run at once, counted from their start, and a call waits for a slot
 * within the same bound; and while one given up on is still running, none of
 * its kind is started at all, a call handed a slot included. Nor is one that
 * waited while its ledger was withdrawn.
 */
async function withinLedgerBound<T>(
  view: ViewState,
  kind: LedgerCall,
  start: () => Promise<T>
): Promise<T | typeof NO_ANSWER | typeof TURNED_AWAY> {
  const calls = view.calls;
  if (calls.stuck[kind] > 0) return TURNED_AWAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const timedOut = new Promise<typeof NO_ANSWER>(resolve => {
    timer = setTimeout(() => {
      expired = true;
      resolve(NO_ANSWER);
    }, LEDGER_CALL_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    if (calls.running[kind] >= MAX_LEDGER_CALLS_IN_FLIGHT) {
      let woken: (() => void) | undefined;
      const slot = new Promise<void>(resolve => {
        woken = resolve;
      });
      const wake = () => woken?.();
      calls.waiting[kind].push(wake);
      const turn = await Promise.race([slot, timedOut]);
      // Its ledger was withdrawn while it waited: started now, a record would
      // land in the withdrawn ledger numbered after the current one's
      // refusals, and pass for their retry. Nothing waits here to pass on to.
      if (calls.closed) return TURNED_AWAY;
      if (expired || turn === NO_ANSWER) {
        const at = calls.waiting[kind].indexOf(wake);
        if (at >= 0) calls.waiting[kind].splice(at, 1);
        // Woken just as the wait ran out: the slot passes on.
        else wakeNext(calls, kind);
        return TURNED_AWAY;
      }
      // The slot was handed over with the running count kept. A call given up
      // on while this one waited closes the gate again: the slot passes on,
      // and each waiting call in turn is turned away the same way.
      if (calls.stuck[kind] > 0) {
        wakeNext(calls, kind);
        return TURNED_AWAY;
      }
    } else {
      calls.running[kind] += 1;
    }
    const call = start();
    let stuck = false;
    const settled = () => {
      if (stuck) calls.stuck[kind] -= 1;
      wakeNext(calls, kind);
    };
    void call.then(settled, settled);
    const answer = await Promise.race([call, timedOut]);
    if (answer === NO_ANSWER) {
      stuck = true;
      calls.stuck[kind] += 1;
    }
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hands a finished call's slot to the call waiting longest, or frees it. The
 * running count is kept through a hand-over, so no new call can slip in
 * between.
 */
function wakeNext(calls: LedgerCalls, kind: LedgerCall): void {
  const next = calls.waiting[kind].shift();
  if (next) next();
  else calls.running[kind] -= 1;
}

interface TagLookup {
  /** When the tag last expired, on the database's clock; 0 when it never has. */
  expiredAt: number;
  /** When the ledger was asked, on this process's clock. */
  askedAt: number;
  /**
   * The copy of this module whose offset the expiry is judged by: the one
   * that asked, or that bounded another copy's answer when it could not ask;
   * an earlier copy writes none.
   */
  by?: symbol;
}

/**
 * This copy of the module, as the lookups it writes name it. The lookups are
 * shared with any other copy still loaded, after a hot reload say, and each
 * copy learns the database's offset its own way: an expiry is judged only by
 * the bound learned with it, so one another copy looked up is asked again.
 */
const THIS_COPY = Symbol("tag expiry view");

/** Whether `lookup` found an expiry that another copy of this module looked up. */
function isForeignExpiry(lookup: TagLookup | undefined): boolean {
  return (
    lookup !== undefined && lookup.by !== THIS_COPY && lookup.expiredAt > 0
  );
}

/**
 * The expiry `known` leaves this copy to judge by when the ledger could not
 * be asked about it, as of `at` on this process's clock. One this copy looked
 * up is as it was. One another copy looked up was learned with that copy's
 * offset, which this copy's may exceed, as after a failover, and judged by a
 * larger offset an entry begun before the expiry looks begun after it. So it
 * is bounded by when it can have been instead: the row it found was written
 * before `at`, and set at most {@link TAG_EXPIRY_GRACE_MS} past its write, so
 * every entry begun before then is refused, whatever offset judges it.
 */
function expiryKnown(
  view: ViewState,
  known: TagLookup | undefined,
  at: number
): number {
  const expiredAt = known?.expiredAt ?? 0;
  if (!isForeignExpiry(known)) return expiredAt;
  return Math.max(expiredAt, at + TAG_EXPIRY_GRACE_MS + offsetOf(view));
}

interface ViewState {
  ledger?: TagExpiryLedger;
  /** The ledger's answers, per tag. */
  lookups: Map<string, TagLookup>;
  /** Tags being asked about now, with the read that will answer them. */
  asking: Map<string, Promise<void>>;
  /**
   * Tags this process expired itself, on this process's clock: converted only
   * when compared, so an offset learned later cannot misplace them.
   */
  own: Map<string, number>;
  /**
   * The ledger times this process's own records wrote, per tag. A lookup
   * answering one of these is judged by `own` and by the database time the
   * record read, not by the grace other instances are held to (this process
   * cleared its registry rows at once).
   */
  mine: Map<string, number>;
  /** The last record attempt's number: attempts are numbered as they start. */
  recordSeq: number;
  /**
   * Per tag, the latest record attempt the ledger refused or did not answer,
   * and when, on this process's clock.
   */
  refusals: Map<string, { seq: number; at: number }>;
  /**
   * Per tag, the latest record attempt that landed, whether it answered in
   * time or after it was given up on. An attempt began after its write
   * committed and read the database's time then, so one that landed covers
   * every refused attempt begun no later than it.
   */
  landedSeq: Map<string, number>;
  /** The calls the published ledger has under way, replaced with it. */
  calls: LedgerCalls;
  /**
   * The database's clock less this process's, at least, as the latest read
   * that found a row told it; undefined until this copy of the module has
   * learned it. A read's statement ran somewhere between its start and its
   * answer, so the database's time it reported, less the answer's local time,
   * is a lower bound. Judged by it, an entry looks no later than it began, so
   * none begun before an expiry passes for one begun after it: a larger offset
   * would accept stale entries, and a smaller one only costs rebuilds. So the
   * latest bound is taken, however loose: an earlier, tighter one may no
   * longer hold, as after a failover to a database whose clock is behind.
   *
   * Its own name, not the `offsetMs` an earlier copy of this module keeps in
   * this shared state: that copy writes the midpoint of its reads there, which
   * is not a lower bound, and is never read here.
   */
  lowerOffsetMs?: number;
  /** When stale answers were last dropped, on this process's clock. */
  sweptAt: number;
  /** The last time `localNow` gave, so the next is strictly later. */
  lastLocal: number;
  warned: boolean;
}

const globalForView = globalThis as unknown as {
  // A copy of this module from before `mine` was kept may have made it.
  __nextly_tag_expiry_view?: Omit<ViewState, "mine"> & {
    mine?: ViewState["mine"];
  };
};

function state(): ViewState {
  globalForView.__nextly_tag_expiry_view ??= {
    lookups: new Map(),
    asking: new Map(),
    own: new Map(),
    mine: new Map(),
    recordSeq: 0,
    refusals: new Map(),
    landedSeq: new Map(),
    calls: noLedgerCalls(),
    sweptAt: 0,
    lastLocal: 0,
    warned: false,
  };
  const view = globalForView.__nextly_tag_expiry_view;
  // A bundled or hot-reloaded copy keeps the state an older copy made, which
  // has no `mine`: given one here, the first record would otherwise throw.
  return Object.assign(view, {
    mine: view.mine ?? new Map(),
    recordSeq: view.recordSeq ?? 0,
    refusals: view.refusals ?? new Map<string, { seq: number; at: number }>(),
    landedSeq: view.landedSeq ?? new Map<string, number>(),
    calls: view.calls ?? noLedgerCalls(),
  });
}

/** Publishes the ledger the handlers read and record into; `null` withdraws it. */
export function publishTagExpiryLedger(ledger: TagExpiryLedger | null): void {
  const view = state();
  view.ledger = ledger ?? undefined;
  // A new ledger is asked afresh about every tag, and its database's clock
  // is learned afresh.
  view.lookups.clear();
  view.lowerOffsetMs = undefined;
  // Its calls are its own: one of the withdrawn ledger's, stuck, ends against
  // that ledger's count, and holds nothing of this one's back; and one still
  // waiting for that ledger's slot is turned away, not started against it.
  closeLedgerCalls(view.calls);
  view.calls = noLedgerCalls();
}

/**
 * The offset entries are judged by: the lower bound learned, or none before
 * one is. Only an expiry a lookup found needs it, and a lookup that finds one
 * learns it.
 */
function offsetOf(view: ViewState): number {
  return view.lowerOffsetMs ?? 0;
}

/** Warns once, through nextly's logger, that the ledger could not be used. */
function warnOnce(reason: string, error: unknown): void {
  const view = state();
  if (view.warned) return;
  view.warned = true;
  getNextlyLogger().warn({
    kind: "cache-tag-ledger-unreachable",
    message: `${reason}; cached reads expire only for writes this instance makes until it can`,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * This process's clock, strictly increasing: two calls in one millisecond are
 * still ordered, so an entry stored just after this process's own expiry is
 * never judged by it. Milliseconds, as `Date.now()`, with a fraction added
 * where the clock has not moved.
 */
export function localNow(): number {
  const view = state();
  const now = Date.now();
  view.lastLocal = now > view.lastLocal ? now : view.lastLocal + 0.001;
  return view.lastLocal;
}

/**
 * Drops what can no longer decide anything, at most once a TTL: answers that
 * found no expiry, once past their TTL, which the next read asks again;
 * answers that found one, and own expiries, once older than the ledger keeps
 * one, which every entry they could expire is refused for by age. An expiry
 * is kept through a refresh that fails, so a ledger that goes down cannot make
 * an entry this process knew to be stale look fresh. The maps then hold the
 * tags served lately and those expired lately, not every tag ever seen.
 */
function sweep(view: ViewState, now: number): void {
  if (now - view.sweptAt < TAG_LOOKUP_TTL_MS) return;
  view.sweptAt = now;
  const databaseHorizon = now + offsetOf(view) - LEDGER_RETENTION_MS;
  for (const [tag, lookup] of view.lookups) {
    const drop =
      lookup.expiredAt > 0
        ? lookup.expiredAt < databaseHorizon
        : now - lookup.askedAt >= TAG_LOOKUP_TTL_MS;
    if (drop) view.lookups.delete(tag);
  }
  const horizon = now - LEDGER_RETENTION_MS;
  for (const [tag, expiredAt] of view.own) {
    if (expiredAt < horizon) view.own.delete(tag);
  }
  for (const [tag, refusal] of view.refusals) {
    if (refusal.at < horizon) view.refusals.delete(tag);
  }
  for (const [tag, storedAt] of view.mine) {
    if (storedAt < databaseHorizon) {
      view.mine.delete(tag);
      view.landedSeq.delete(tag);
    }
  }
}

/**
 * Asks the ledger about each of `tags` whose answer is older than the TTL,
 * in one read, sharing any read already under way for the rest. Never throws.
 */
export async function refreshTagExpiries(
  tags: Iterable<string>
): Promise<void> {
  const view = state();
  const now = Date.now();
  sweep(view, now);
  const ledger = view.ledger;
  if (ledger === undefined) return;
  const pending = new Set<Promise<void>>();
  const stale: string[] = [];
  for (const tag of new Set(tags)) {
    const asking = view.asking.get(tag);
    const lookup = view.lookups.get(tag);
    if (asking !== undefined) pending.add(asking);
    else if (
      now - (lookup?.askedAt ?? -Infinity) >= TAG_LOOKUP_TTL_MS ||
      // An expiry another copy of this module looked up, whose offset this
      // copy has not learned with it: asked again, which tells it.
      isForeignExpiry(lookup)
    ) {
      stale.push(tag);
    }
  }
  if (stale.length > 0) {
    const read = (async () => {
      try {
        const answer = await withinLedgerBound(view, "lookup", () =>
          ledger.expiriesOf(stale)
        );
        if (answer === NO_ANSWER || answer === TURNED_AWAY) {
          warnOnce(
            "the cache tag expiry ledger could not be read",
            answer === NO_ANSWER
              ? `no answer within ${LEDGER_CALL_TIMEOUT_MS} ms`
              : "an earlier lookup has not answered"
          );
          // Unlike a read that failed, which says the ledger is down, one that
          // never answered may have been about to say these tags expired. So
          // they count as expired when it was given up on: an entry begun
          // before then is refused and read afresh, and one begun after it is
          // served. The next lookup, a TTL later, says what the ledger holds.
          const givenUpAt = Date.now();
          for (const tag of stale) {
            view.lookups.set(tag, {
              expiredAt: Math.max(
                expiryKnown(view, view.lookups.get(tag), givenUpAt),
                givenUpAt + offsetOf(view)
              ),
              askedAt: givenUpAt,
              by: THIS_COPY,
            });
          }
          return;
        }
        const finishedAt = Date.now();
        // A read that found no rows carries no clock to learn from.
        if (answer?.now !== undefined) {
          view.lowerOffsetMs = answer.now - finishedAt;
        }
        for (const tag of stale) {
          view.lookups.set(tag, {
            expiredAt: answer?.expired.get(tag) ?? 0,
            askedAt: finishedAt,
            by: THIS_COPY,
          });
        }
      } catch (error) {
        warnOnce("the cache tag expiry ledger could not be read", error);
        // Not asked again until the TTL passes, so a ledger that is down is
        // not read on every request; what was known before is kept, an
        // expiry another copy looked up bounded so this copy can judge by it.
        // Left as that copy's, it would be asked again at every read.
        const failedAt = Date.now();
        for (const tag of stale) {
          view.lookups.set(tag, {
            expiredAt: expiryKnown(view, view.lookups.get(tag), failedAt),
            askedAt: failedAt,
            by: THIS_COPY,
          });
        }
      } finally {
        for (const tag of stale) view.asking.delete(tag);
      }
    })();
    for (const tag of stale) view.asking.set(tag, read);
    pending.add(read);
  }
  await Promise.all(pending);
}

/**
 * The ledger's time for `tag` as this process judges by it: another
 * instance's, as stored; for a time this process's own record stored, the
 * database's time that record read, without the grace. This process's expiry
 * is already in `own`, and the grace is for other instances, which may still
 * hold registry rows this process cleared at once: judged by it, an entry this
 * process filled within the grace would be refused once more. The time is
 * still judged by its reading rather than ignored, because another instance
 * may record the same tag in the same millisecond, and only the time says
 * which: an entry begun before that reading is refused, whoever recorded it.
 */
function recordedExpiry(view: ViewState, tag: string): number {
  const recorded = view.lookups.get(tag)?.expiredAt ?? 0;
  return recorded > 0 && view.mine.get(tag) === recorded
    ? recorded - TAG_EXPIRY_GRACE_MS
    : recorded;
}

/** When `tag` last expired as far as this process knows, on the database's clock. */
function expiryOf(view: ViewState, tag: string): number {
  const own = view.own.get(tag);
  return Math.max(
    recordedExpiry(view, tag),
    own === undefined ? 0 : own + offsetOf(view)
  );
}

/**
 * Whether an entry begun at `storedAt` (this process's clock) carrying `tags`
 * must not be served: one of its tags expired after it began, or it is older
 * than the ledger keeps an expiry, past which a pruned row could no longer say
 * so. Asks nothing; `refreshTagExpiries` first.
 */
export function isEntryExpired(
  tags: Iterable<string>,
  storedAt: number
): boolean {
  if (Date.now() - storedAt > LEDGER_RETENTION_MS) return true;
  const view = state();
  const storedOnDatabaseClock = storedAt + offsetOf(view);
  for (const tag of tags) {
    // Another instance's expiry, on the database's clock, has no order with
    // this process's events: at or after, since an entry begun in the same
    // millisecond may hold the old value, and regenerating it costs one read.
    const recorded = recordedExpiry(view, tag);
    if (recorded > 0 && recorded >= storedOnDatabaseClock) return true;
    // This process's own expiry is ordered with its entries by `localNow`, so
    // strictly after: an entry begun once the expiry was made is fresh.
    const own = view.own.get(tag);
    if (own !== undefined && own > storedAt) return true;
  }
  return false;
}

/** The latest expiry among `tags`, on this process's clock; 0 when none expired. */
export function latestExpiry(tags: Iterable<string>): number {
  const view = state();
  let latest = 0;
  for (const tag of tags) {
    const expiredAt = expiryOf(view, tag);
    if (expiredAt > 0) latest = Math.max(latest, expiredAt - offsetOf(view));
  }
  return latest;
}

/**
 * What became of an expiry outside this process: recorded in the ledger; no
 * ledger published; no table yet (a migration not run, so no instance shares
 * expiries yet); or a write the database refused, which a retry may get past.
 */
export type ExpiryRecord = "recorded" | "no-ledger" | "no-table" | "failed";

/**
 * Expires `tags` now: in this process at once, so this instance never serves
 * its own write stale, and in the ledger for every other instance. A refused
 * write is warned about once. This instance stays correct whatever the
 * answer; a caller that must reach other instances decides from it whether to
 * keep the tags.
 */
export async function expireTags(
  tags: readonly string[]
): Promise<ExpiryRecord> {
  const view = state();
  const now = localNow();
  for (const tag of tags) view.own.set(tag, now);
  return record(view, tags, false);
}

/**
 * Records `tags` again, for other instances, without expiring them in this
 * process a second time: their expiry here is the one made when they were
 * written, and an entry regenerated since then is fresh.
 */
export function recordExpiredTagsAgain(
  tags: readonly string[]
): Promise<ExpiryRecord> {
  return record(state(), tags, true);
}

/** Writes `tags` to the ledger; `again` marks a retry of an earlier expiry. */
async function record(
  view: ViewState,
  tags: readonly string[],
  again: boolean
): Promise<ExpiryRecord> {
  const ledger = view.ledger;
  if (ledger === undefined) return "no-ledger";
  // Numbered as it starts, so a refusal is ordered with the records that
  // land; see TURNED_AWAY below for one that never starts.
  let seq = 0;
  const begin = () => {
    view.recordSeq += 1;
    seq = view.recordSeq;
    return seq;
  };
  try {
    // What a record that lands stores, even one given up on: a late one is
    // the expiry this process judges by, and a retry need not make it again.
    const answer = await withinLedgerBound(view, "record", () => {
      const attempt = begin();
      return ledger.record(tags).then(stored => {
        if (stored === false) return stored;
        for (const [tag, at] of stored) {
          view.mine.set(tag, at);
          view.landedSeq.set(
            tag,
            Math.max(view.landedSeq.get(tag) ?? 0, attempt)
          );
        }
        return stored;
      });
    });
    if (answer === TURNED_AWAY) {
      // A retry that never started leaves the refusals as they were: the
      // stuck call it waited behind may still land and cover them. A write's
      // own record that never started is a refusal of its own, later than any
      // call under way, which an earlier one landing cannot cover.
      if (again) {
        warnOnce(
          "the cache tag expiry ledger could not record an expiry",
          "an earlier record has not answered"
        );
      } else {
        refused(
          view,
          tags,
          begin(),
          again,
          "an earlier record has not answered"
        );
      }
      return "failed";
    }
    if (answer === NO_ANSWER) {
      refused(
        view,
        tags,
        seq,
        again,
        `no answer within ${LEDGER_CALL_TIMEOUT_MS} ms`
      );
      return "failed";
    }
    return answer === false ? "no-table" : "recorded";
  } catch (error) {
    refused(view, tags, seq, again, error);
    return "failed";
  }
}

/**
 * Says that the ledger refused `tags`: once as the ledger's state, and for a
 * first attempt with its tags, so the content another instance may still
 * serve stale can be named. A retry of tags already said is not, since the
 * retry says when it begins and when it succeeds.
 */
function refused(
  view: ViewState,
  tags: readonly string[],
  seq: number,
  again: boolean,
  error: unknown
): void {
  const at = Date.now();
  for (const tag of tags) {
    const before = view.refusals.get(tag)?.seq ?? 0;
    view.refusals.set(tag, { seq: Math.max(before, seq), at });
  }
  warnOnce("the cache tag expiry ledger could not record an expiry", error);
  if (again) return;
  getNextlyLogger().warn({
    kind: "cache-tag-record-failed",
    message: `the cache tag expiry ledger refused the expiry of ${tags.join(", ")}; it is retried until recorded`,
    tags: [...tags],
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Whether the latest refused record of `tag` is covered by one that landed
 * since: that attempt itself, answering after it was given up on, or a later
 * one. An earlier attempt landing late covers nothing: it read the database's
 * time before the refused write's, which it may not have followed.
 */
export function refusalLanded(tag: string): boolean {
  const view = state();
  const refusal = view.refusals.get(tag);
  return refusal !== undefined && (view.landedSeq.get(tag) ?? 0) >= refusal.seq;
}

/**
 * Forgets the refusals a landed record covers, once the retry has acted on
 * them, so tags another flush recorded leave nothing behind. Those not yet
 * covered stay, and age out with the ledger's retention.
 */
export function forgetLandedRefusals(): void {
  const view = state();
  for (const [tag, refusal] of view.refusals) {
    if ((view.landedSeq.get(tag) ?? 0) >= refusal.seq) {
      view.refusals.delete(tag);
    }
  }
}
