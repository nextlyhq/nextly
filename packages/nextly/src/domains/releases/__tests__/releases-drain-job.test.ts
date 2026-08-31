/**
 * The drain job's one real decision: how long it may run for.
 *
 * Everything else here is assembly — a repository, mutations, a reporter. What
 * is worth testing is the budget, because getting it wrong is invisible: a pass
 * that overruns its invocation is killed after doing partial work, and a pass
 * that never stops looks exactly like a pass with nothing to do.
 *
 * The assertions below are about the STOPPING PREDICATE the pass evaluates —
 * `now() >= deadline` — rather than about the deadline value handed over. A
 * value assertion passes for an implementation that computes the right number on
 * the wrong clock, which is the specific defect these guard.
 *
 * @module domains/releases/__tests__/releases-drain-job.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplyDueReleasesDeps } from "../apply-due-releases";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("../apply-due-releases", () => ({ applyDueReleases: applyMock }));

const { createReleasesDrainJob } = await import("../releases-drain-job");

/** A pass that did nothing; these cases never inspect the report. */
const NOTHING_DUE = {
  due: 0,
  published: 0,
  applied: 0,
  failed: 0,
  deferred: 0,
  undischarged: 0,
  outcomes: [],
};

/** Wall time when the handler is entered. */
const REAL_START = new Date("2026-06-01T12:00:00.000Z");

/**
 * The instant the RUNNER is treating as now, deliberately years from wall time.
 *
 * `runJobs` resolves ONE clock (`deps.now ?? (() => new Date())`) and derives
 * both `context.now` and `context.deadline` from it, so a caller supplying the
 * documented `now` option moves BOTH away from wall time together. The gap here
 * is what makes an implementation anchored to `Date.now()` observably wrong;
 * pinning this to wall time would let that defect pass every case below.
 */
const CONTEXT_NOW = new Date("2020-01-01T00:00:00.000Z");

/**
 * Run the handler at {@link REAL_START} and return the deps the pass received.
 *
 * `msLeftInPass` is what the RUNNER has left, which is what the drain must fit
 * inside — not a budget of the job's own.
 */
let wallStart = REAL_START;

async function runHandler(
  msLeftInPass: number,
  wallClockAtEntry: Date = REAL_START
): Promise<ApplyDueReleasesDeps> {
  wallStart = wallClockAtEntry;
  vi.setSystemTime(wallClockAtEntry);
  let captured: ApplyDueReleasesDeps | undefined;
  applyMock.mockImplementation(async (deps: ApplyDueReleasesDeps) => {
    captured = deps;
    return NOTHING_DUE;
  });

  const job = createReleasesDrainJob({
    db: {} as never,
    contentApi: {} as never,
    runAs: {} as never,
    onOutcome: () => {},
  });

  await job.handler(null as never, {
    user: null,
    now: CONTEXT_NOW,
    content: {} as never,
    // Derived from CONTEXT_NOW, because that is the only context `runJobs` can
    // emit: it builds the deadline from the same clock it builds `now` from. A
    // fixture pairing an injected `now` with a wall-time deadline pins an input
    // the runner cannot produce, and leaves the reachable one unasserted.
    deadline: new Date(CONTEXT_NOW.getTime() + msLeftInPass),
  });

  if (captured === undefined) throw new Error("the pass never ran");
  return captured;
}

/** What the pass asks itself before starting more work. */
function passWouldStop(deps: ApplyDueReleasesDeps, atRealMs: number): boolean {
  vi.setSystemTime(new Date(wallStart.getTime() + atRealMs));
  const now = deps.now?.() ?? new Date();
  return now.getTime() >= (deps.deadline?.getTime() ?? Infinity);
}

describe("createReleasesDrainJob", () => {
  afterEach(() => {
    vi.useRealTimers();
    applyMock.mockReset();
  });

  it("stops when the runner's deadline arrives, on the same clock the pass reads", async () => {
    vi.useFakeTimers();
    const deps = await runHandler(4_000);

    // The runner's clock is years behind wall time, which is the case an
    // implementation anchored to `Date.now()` gets wrong: the remaining span
    // collapses to zero and the drain starts nothing on any pass. Both fields
    // come from the runner, so the span must be measured between them.
    expect(passWouldStop(deps, 3_000)).toBe(false);
    expect(passWouldStop(deps, 4_000)).toBe(true);
  });

  it("takes what is LEFT of the pass, so a drain starting late cannot overrun it", async () => {
    vi.useFakeTimers();
    // A pass most of the way through its tick: an earlier job overran and left
    // this one two seconds. A fixed budget cannot know that, and the drain would
    // keep starting content mutations long after the invocation should have
    // ended — being killed part-way rather than deferring cleanly.
    const deps = await runHandler(2_000);

    expect(passWouldStop(deps, 1_500)).toBe(false);
    expect(passWouldStop(deps, 2_000)).toBe(true);
  });

  it("grants no budget when the pass is already spent, rather than a negative one", async () => {
    vi.useFakeTimers();
    // Deliberately NOT titled "starts nothing". `applyWithinBudget` exempts the
    // first component from the deadline, so an exhausted budget still performs
    // one component's mutations — which is correct and is not something this
    // case can observe, because the pass is mocked here. Skipping the pass
    // outright instead would report a clean empty drain while work was
    // deferred, which is the failure #1360 exists to prevent.
    const deps = await runHandler(0);

    expect(passWouldStop(deps, 0)).toBe(true);
  });

  it("does not grant more than the pass has, when the runner's clock runs ahead", async () => {
    vi.useFakeTimers();
    // The overrun direction, and the more dangerous one: a span measured against
    // wall time from a runner clock AHEAD of it is longer than the pass, so the
    // drain keeps starting content mutations after the invocation should have
    // ended. Both fields move together, so the span must not.
    // Wall time an hour BEHIND the runner's clock, which is the same thing as
    // the runner's clock running ahead. Passed in, because the fixture pins wall
    // time on entry and setting it beforehand would simply be overwritten.
    const deps = await runHandler(
      3_000,
      new Date(CONTEXT_NOW.getTime() - 60 * 60 * 1000)
    );

    expect(passWouldStop(deps, 2_500)).toBe(false);
    expect(passWouldStop(deps, 3_000)).toBe(true);
  });
});
