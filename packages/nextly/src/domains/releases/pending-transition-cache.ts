/**
 * The cheap check that keeps the release lookup off the common read path.
 *
 * Consulting releases on every content read would put a query in front of
 * every page. One question removes it for the overwhelmingly common case:
 * what is the earliest instant ANY scheduled release takes effect? While
 * `now` is before that instant, no document can be affected by anything, and
 * the answer is a comparison between two numbers that touches no database.
 *
 * The memo is bounded by a short TTL, and that is a correctness requirement
 * rather than tuning. A memo invalidated only by LOCAL writes is wrong in the
 * dangerous direction as soon as more than one instance is serving: another
 * instance schedules an earlier transition, this instance keeps answering
 * "nothing due" from a memo nothing here invalidated, and the release is
 * silently missed — a failure indistinguishable from the release never having
 * existed. The TTL bounds that staleness to a known window. A local schedule
 * write still calls {@link PendingTransitionCache.invalidate} and takes effect
 * at once, so the single-instance case stays exact; the window exists only for
 * the instances that did not perform the write.
 *
 * Residual behaviour, stated so it is not rediscovered as a bug: a release may
 * go live up to {@link DEFAULT_TTL_MS} late on a multi-instance deployment
 * that has had no local write. It is never missed, and never early.
 *
 * @module domains/releases/pending-transition-cache
 */

/**
 * Every instant a scheduled release takes effect, ascending.
 *
 * The whole list, because two callers ask different questions of it: "is
 * anything due?" wants an instant at or before now, and "when could this page
 * next go stale?" wants the next one strictly after. Those answers differ
 * exactly when an overdue release is still scheduled, and loading only the
 * earliest would make the second unanswerable.
 *
 * Satisfied by `ReleasesRepository.findScheduledTransitions`. Taken as a
 * function rather than the repository so this holds no opinion about where the
 * answer comes from.
 */
export type ScheduledTransitionsLoader = () => Promise<Date[]>;

/**
 * How long an unrefreshed memo may be trusted.
 *
 * The window is the deployment's exposure to a transition scheduled by another
 * instance: long enough that the common read costs nothing, short enough that
 * "up to half a minute late" is an acceptable description of the worst case.
 */
export const DEFAULT_TTL_MS = 30_000;

/**
 * A loaded answer.
 *
 * An EMPTY list is a VALUE — "nothing is scheduled" — so it is held inside a
 * memo object rather than represented by the absence of one. Folding the two
 * together would make every read on a site with no releases reload, which is
 * the exact cost this class exists to remove, and no returned answer would
 * differ.
 */
interface TransitionMemo {
  instants: Date[];
  loadedAtMs: number;
}

export class PendingTransitionCache {
  /** `null` means nothing has been loaded yet, never "nothing is scheduled". */
  private memo: TransitionMemo | null = null;

  /**
   * A single load shared by concurrent callers, tagged with the generation it
   * began under. Every content read consults this class, so without the
   * sharing a TTL lapse under load would issue one query per in-flight
   * request; without the tag, a load that began before an invalidation could
   * commit the answer that invalidation just discarded.
   */
  private inFlight: Promise<Date[]> | null = null;
  private inFlightGeneration = -1;
  private generation = 0;

  private readonly ttlMs: number;

  constructor(
    private readonly load: ScheduledTransitionsLoader,
    options?: { ttlMs?: number }
  ) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Whether any release could be affecting a document at `now`.
   *
   * `false` is final: the caller does no per-document work. `true` only means
   * the cheap check cannot rule it out, and the caller goes on to ask which
   * documents are actually affected.
   */
  async mayHaveDue(now: Date): Promise<boolean> {
    const nowMs = now.getTime();
    return (await this.transitions(now)).some(at => at.getTime() <= nowMs);
  }

  /**
   * The memoized instants, loading them when the memo has lapsed.
   *
   * Both public questions come through here, so a read asking each of them
   * issues ONE query rather than two.
   */
  private async transitions(now: Date): Promise<Date[]> {
    const nowMs = now.getTime();
    const memo = this.memo;
    if (memo !== null && isFresh(memo, nowMs, this.ttlMs)) return memo.instants;
    return this.loadInstants(nowMs);
  }

  /**
   * The earliest instant any scheduled release takes effect, memoized.
   *
   * The same answer {@link mayHaveDue} reduces to a boolean, returned whole
   * for the caller that needs the INSTANT rather than the verdict: a cache
   * lifetime derived from the schedule. Sharing the memo is the point — a
   * read that asks both questions must not issue two queries, and a second
   * loader would be a second answer to drift from this one.
   */
  async nextTransition(now: Date): Promise<Date | null> {
    // Deliberately NOT the earliest instant. The earliest may already be in the
    // past — a release held open by a failed member stays `scheduled` — and a
    // bound derived from it would report "nothing to wait for" forever while a
    // genuinely future release went unbounded. This asks the question the cache
    // actually has: what is the next instant a page could go stale AT.
    const nowMs = now.getTime();
    for (const instant of await this.transitions(now)) {
      if (instant.getTime() > nowMs) return instant;
    }
    return null;
  }

  /**
   * Drop the memo so the next check reads again.
   *
   * Called by the writes that change the answer — scheduling, rescheduling and
   * cancelling — so the instance that performed one is never bounded by the
   * TTL.
   */
  invalidate(): void {
    this.memo = null;
    this.generation++;
  }

  private async loadInstants(nowMs: number): Promise<Date[]> {
    if (this.inFlight !== null && this.inFlightGeneration === this.generation) {
      return this.inFlight;
    }

    const generation = this.generation;
    const pending = this.load().then(
      instants => {
        // Commit only if nothing invalidated while this was running: an answer
        // read before a local write describes the state that write replaced,
        // and storing it would reinstate it for a full TTL.
        if (generation === this.generation) {
          this.memo = { instants, loadedAtMs: nowMs };
        }
        if (this.inFlight === pending) this.inFlight = null;
        // Not just "do not memoize it" — do not RETURN it either. A caller
        // handed the pre-invalidation answer caches its page against a schedule
        // that has already changed, and the flush that accompanied the
        // invalidation has by then already run. Reload instead, so the answer
        // this caller acts on is the one the write left behind.
        if (generation !== this.generation) return this.loadInstants(nowMs);
        return instants;
      },
      error => {
        // A rejected promise left in `inFlight` would be handed to every later
        // caller, turning one transient failure into a permanently broken read
        // path. The failure propagates rather than being answered `false`,
        // which would be a claim that nothing is scheduled.
        if (this.inFlight === pending) this.inFlight = null;
        throw error;
      }
    );

    this.inFlight = pending;
    this.inFlightGeneration = generation;
    return pending;
  }
}

/**
 * Freshness is measured against the same `now` the due comparison uses, so the
 * two cannot disagree about what time it is.
 *
 * Elapsed time outside the window in EITHER direction expires the memo: a
 * caller whose clock jumped backwards would otherwise hold the memo well past
 * the window, and re-reading is the safe direction.
 */
function isFresh(memo: TransitionMemo, nowMs: number, ttlMs: number): boolean {
  const elapsed = nowMs - memo.loadedAtMs;
  return elapsed >= 0 && elapsed < ttlMs;
}

/**
 * Inclusive at the instant itself, matching `resolveReleaseEffect`: a member
 * scheduled for exactly `now` is due. Answering otherwise here would hide it
 * from the rule that would have applied it.
 */
