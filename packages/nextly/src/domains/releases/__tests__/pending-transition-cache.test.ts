/**
 * The cheap due-check that keeps the release lookup off the common read path.
 *
 * Two properties carry the weight here, and both are correctness rather than
 * performance:
 *
 *   1. The loader answers `Date | null`, where `null` means "no release is
 *      scheduled at all". That is a VALUE, not the absence of one, so a memo
 *      that stores it as "nothing cached" reloads on every read forever. The
 *      call-count assertions are what catch that; the returned booleans are
 *      identical either way.
 *   2. The memo expires. A memo invalidated only by LOCAL writes is wrong in
 *      the dangerous direction once more than one instance is serving: another
 *      instance schedules an earlier transition, this one keeps answering
 *      "nothing due", and the release is silently missed.
 *
 * @module domains/releases/__tests__/pending-transition-cache.test
 */
import { describe, it, expect, vi } from "vitest";

import { PendingTransitionCache } from "../pending-transition-cache";

const T0 = new Date("2026-06-01T12:00:00.000Z");
const after = (ms: number): Date => new Date(T0.getTime() + ms);

/** The instant a release takes effect, comfortably after every TTL window. */
const SOON = after(10 * 60_000);

const TTL = { ttlMs: 30_000 };

/** A loader stub, typed so a wrong resolved shape fails to compile. */
const loader = () => vi.fn<() => Promise<Date[]>>();

describe("PendingTransitionCache", () => {
  it("answers false without a second load when nothing is scheduled", async () => {
    // An EMPTY list is the loader's answer for "nothing scheduled", and it has
    // to survive in the memo as that answer. Storing it as "not loaded" gives
    // the same `false` here while querying the database on every content read —
    // which is the whole cost this class exists to avoid, so the count is the
    // only thing that separates the two.
    const load = loader().mockResolvedValue([]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(false);
    await expect(cache.mayHaveDue(after(1_000))).resolves.toBe(false);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers false from the memo alone while the instant is still ahead", async () => {
    const load = loader().mockResolvedValue([SOON]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(false);
    await expect(cache.mayHaveDue(after(1_000))).resolves.toBe(false);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers true once the instant arrives, from that same memo", async () => {
    // The positive control for the test above: without this, an implementation
    // that always answered `false` and never loaded would satisfy it.
    const load = loader().mockResolvedValue([after(5_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(false);
    await expect(cache.mayHaveDue(after(6_000))).resolves.toBe(true);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("treats the instant itself as due, not as still ahead", async () => {
    const load = loader().mockResolvedValue([after(5_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(after(5_000))).resolves.toBe(true);
  });

  it("reports a release whose instant has already passed", async () => {
    // The loader is deliberately not filtered to future instants: a release
    // whose time has passed but which nothing has materialised yet is
    // affecting reads right now. Answering `false` here would skip exactly the
    // case the lookup exists to catch.
    const load = loader().mockResolvedValue([new Date(T0.getTime() - 60_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(true);
  });

  it("nextTransition skips an instant that has already passed", async () => {
    // The two questions differ exactly here. An overdue release stays
    // `scheduled` when a member fails, so `mayHaveDue` must still say true —
    // the read path has work to do — while a cache lifetime derived from that
    // same instant would be a negative number, degrade to tag-only, and leave a
    // page unbounded past the NEXT release.
    const past = new Date(T0.getTime() - 60_000);
    const load = loader().mockResolvedValue([past, SOON]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(true);
    await expect(cache.nextTransition(T0)).resolves.toEqual(SOON);
    // One load answers both, which is what keeps this off the hot path.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("nextTransition is null when every instant has passed", async () => {
    // The control. A cache that returned the first element regardless would
    // satisfy the case above and hand back an instant in the past here, from
    // which the bound would compute a negative lifetime.
    const load = loader().mockResolvedValue([new Date(T0.getTime() - 60_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.nextTransition(T0)).resolves.toBeNull();
  });

  it("does not hand an INVALIDATED in-flight load to its waiting caller", async () => {
    // Not merely "do not memoize it". A caller handed the pre-invalidation
    // answer caches its page against a schedule that has already changed — and
    // the flush that accompanied the invalidation has by then already run, so
    // nothing will clear that entry again. It must reload instead.
    let release: ((value: Date[]) => void) | undefined;
    const load = loader()
      .mockReturnValueOnce(
        new Promise<Date[]>(resolve => {
          release = resolve;
        })
      )
      .mockResolvedValueOnce([SOON]);
    const cache = new PendingTransitionCache(load, TTL);

    const inFlight = cache.nextTransition(T0);
    cache.invalidate();
    release?.([]); // the pre-invalidation answer: nothing scheduled

    // The waiting caller gets the RELOADED answer, not the stale one.
    await expect(inFlight).resolves.toEqual(SOON);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("re-reads after the TTL even when no local write happened", async () => {
    // A memo invalidated only by LOCAL writes is wrong in the dangerous
    // direction under more than one server instance: another instance
    // schedules an EARLIER transition, this one still answers "nothing due",
    // and the release is silently missed — indistinguishable from no release
    // existing. The TTL bounds that staleness. It is a correctness
    // requirement, not tuning.
    const load = loader().mockResolvedValue([SOON]);
    const cache = new PendingTransitionCache(load, TTL);

    await cache.mayHaveDue(T0);
    await cache.mayHaveDue(after(29_000));
    expect(load).toHaveBeenCalledTimes(1);

    await cache.mayHaveDue(after(31_000));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("sees an earlier transition another instance scheduled, once the TTL lapses", async () => {
    // The consequence of the test above, stated as the outcome that matters:
    // the answer must actually CHANGE, not merely re-read. A re-read whose
    // result is discarded would satisfy a call count and still miss the
    // release.
    const load = loader()
      .mockResolvedValueOnce([SOON])
      .mockResolvedValueOnce([after(20_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(false);
    await expect(cache.mayHaveDue(after(31_000))).resolves.toBe(true);
  });

  it("re-reads immediately after invalidate(), without waiting for the TTL", async () => {
    // A local schedule write clears the memo, so the instance that performed
    // the write is exact rather than merely bounded.
    const load = loader()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([after(1_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).resolves.toBe(false);
    cache.invalidate();
    await expect(cache.mayHaveDue(after(2_000))).resolves.toBe(true);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent callers onto one load", async () => {
    // Every content read consults this, so a TTL lapse under load would fire
    // one query per in-flight request without this.
    let release: ((value: Date[]) => void) | undefined;
    const load = loader().mockReturnValue(
      new Promise<Date[]>(resolve => {
        release = resolve;
      })
    );
    const cache = new PendingTransitionCache(load, TTL);

    const answers = Promise.all([
      cache.mayHaveDue(T0),
      cache.mayHaveDue(T0),
      cache.mayHaveDue(T0),
    ]);
    release?.([SOON]);

    await expect(answers).resolves.toEqual([false, false, false]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not memoise a failed load, and stays usable afterwards", async () => {
    // A rejected promise retained as the in-flight load would be handed to
    // every later caller, turning one transient database error into a
    // permanently broken read path.
    const load = loader()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce([after(1_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    await expect(cache.mayHaveDue(T0)).rejects.toThrow("connection reset");
    await expect(cache.mayHaveDue(after(2_000))).resolves.toBe(true);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("discards a load that was already running when invalidate() was called", async () => {
    // The load was started against the state BEFORE the local write, so
    // committing it would reinstate the answer the write just invalidated —
    // and it would then sit there for a full TTL.
    let release: ((value: Date[]) => void) | undefined;
    const load = loader()
      .mockReturnValueOnce(
        new Promise<Date[]>(resolve => {
          release = resolve;
        })
      )
      .mockResolvedValueOnce([after(1_000)]);
    const cache = new PendingTransitionCache(load, TTL);

    const stale = cache.mayHaveDue(T0);
    cache.invalidate();
    release?.([]);
    await stale;

    await expect(cache.mayHaveDue(after(2_000))).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
