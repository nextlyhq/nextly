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
 * `JobContext.now` is injected so a job is testable, so the two clocks are not
 * required to agree — and an implementation that mixes them is only wrong when
 * they differ. Pinning them together would make both cases below pass against
 * the defect they exist to catch.
 */
const CONTEXT_NOW = new Date("2020-01-01T00:00:00.000Z");

/**
 * Run the handler at {@link REAL_START} and return the deps the pass received.
 *
 * `msLeftInPass` is what the RUNNER has left, which is what the drain must fit
 * inside — not a budget of the job's own.
 */
async function runHandler(msLeftInPass: number): Promise<ApplyDueReleasesDeps> {
  vi.setSystemTime(REAL_START);
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
    deadline: new Date(REAL_START.getTime() + msLeftInPass),
  });

  if (captured === undefined) throw new Error("the pass never ran");
  return captured;
}

/** What the pass asks itself before starting more work. */
function passWouldStop(deps: ApplyDueReleasesDeps, atRealMs: number): boolean {
  vi.setSystemTime(new Date(REAL_START.getTime() + atRealMs));
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

    // The runner's clock and wall time are years apart here. `deadline` is a
    // REAL instant and `now()` is virtual, so an implementation that hands
    // `context.deadline` straight through compares 2026 against 2020 and the
    // pass never stops at all.
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

  it("starts nothing when the pass is already at its deadline", async () => {
    vi.useFakeTimers();
    // Never a negative budget, which would read as a deadline in the past on the
    // virtual clock and defer every component including ones this pass applied.
    const deps = await runHandler(0);

    expect(passWouldStop(deps, 0)).toBe(true);
  });
});
