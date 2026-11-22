/**
 * The long editing session's judgement
 * (`e2e/builder-speed/long-session-report.mjs`): which long tasks count
 * against the one-second limit, that a task both frames saw counts once, and
 * the heap readings the report quotes.
 *
 * Here rather than under `e2e/`, where every `*.test.*` file is taken as a
 * browser spec.
 */
import { describe, expect, it } from "vitest";

import {
  GRACE_MS,
  LONG_TASK_LIMIT_MS,
  heapGrowth,
  judgeLock,
  judgeLongTasks,
  mergeLongTasks,
  readingsAt,
} from "../e2e/builder-speed/long-session-report.mjs";

const startedAt = 1_000_000;
const endedAt = startedAt + 30 * 60_000;
const at = (seconds, ms) => ({
  start: startedAt + seconds * 1000,
  duration: ms,
});

describe("mergeLongTasks", () => {
  it("counts a task both frames reported once, at its longer duration", () => {
    // The admin's frame and the canvas share a main thread; counting both
    // entries would double every task the canvas took part in.
    const merged = mergeLongTasks([
      [at(70, 300), at(90, 120)],
      [at(70, 340.4)],
    ]);
    expect(merged).toEqual([at(70, 340.4), at(90, 120)]);
  });

  it("keeps tasks that only start close together", () => {
    expect(mergeLongTasks([[at(70, 80)], [at(70.01, 90)]])).toHaveLength(2);
  });
});

describe("judgeLongTasks", () => {
  it("fails a task over the limit after the first minute, naming when and how long", () => {
    const verdict = judgeLongTasks([at(61, 120), at(600, 1500)], {
      startedAt,
      endedAt,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.over).toEqual([{ atSecond: 600, ms: 1500 }]);
    expect(verdict.longestMs).toBe(1500);
    expect(verdict.counted).toBe(2);
  });

  it("passes a task at the limit, which is not longer than it", () => {
    const verdict = judgeLongTasks([at(600, LONG_TASK_LIMIT_MS)], {
      startedAt,
      endedAt,
    });
    expect(verdict.passed).toBe(true);
  });

  it("leaves the first minute out, where the builder is still warming up", () => {
    const verdict = judgeLongTasks([at(GRACE_MS / 1000 - 1, 4000)], {
      startedAt,
      endedAt,
    });
    expect(verdict).toEqual({
      counted: 0,
      over: [],
      longestMs: 0,
      passed: true,
    });
  });

  it("leaves out the session's own garbage collections, and nothing else", () => {
    // The heap reading forces collections, a task of the check's, not the
    // builder's. A task just outside the window still counts.
    const verdict = judgeLongTasks([at(300, 1800), at(302, 1200)], {
      startedAt,
      endedAt,
      paused: [{ from: startedAt + 299_500, to: startedAt + 301_000 }],
    });
    expect(verdict.over).toEqual([{ atSecond: 302, ms: 1200 }]);
  });

  it("leaves out what comes after the session", () => {
    const verdict = judgeLongTasks([at(30 * 60 + 5, 3000)], {
      startedAt,
      endedAt,
    });
    expect(verdict.passed).toBe(true);
  });
});

describe("the heap readings", () => {
  const samples = [0, 1.02, 2.01, 9.9, 10.1, 20.3, 29.8, 30.4].map(
    (minute, i) => ({ minute, heapBytes: 30e6 + i * 1e6 })
  );

  it("reads the sample nearest each minute asked for", () => {
    const readings = readingsAt(samples, [1, 10, 20, 30]);
    expect(readings[1].minute).toBe(1.02);
    expect(readings[10].minute).toBe(9.9);
    expect(readings[20].minute).toBe(20.3);
    expect(readings[30].minute).toBe(29.8);
  });

  it("reads a minute the run did not reach as null", () => {
    expect(readingsAt(samples, [45])[45]).toBeNull();
  });

  it("measures growth from the first minute, not from the opening", () => {
    // 31 MB at the first minute, 37 MB at the end.
    expect(heapGrowth(samples)).toBe(19.4);
  });

  it("has no growth to report from a single reading", () => {
    expect(heapGrowth([{ minute: 1, heapBytes: 30e6 }])).toBeNull();
  });
});

describe("judgeLock", () => {
  // Ten minutes at a 15-second heartbeat: 40 beats, so at least 20 renewals
  // confirmed at half rate.
  const from = 2_000_000;
  const to = from + 10 * 60_000;
  const window = { from, to, heartbeatMs: 15_000 };
  const claim = { at: from - 5000, method: "POST", answer: "acquired" };
  const renewals = count =>
    Array.from({ length: count }, (_, i) => ({
      at: from + (i + 1) * 15_000,
      method: "PATCH",
      answer: "renewed",
    }));
  const quiet = [{ minute: 5, lock: null }];

  it("passes a claim granted and renewed on every beat, with no notice", () => {
    const verdict = judgeLock([claim, ...renewals(40)], quiet, window);
    expect(verdict).toMatchObject({
      claimed: true,
      renewals: 40,
      expected: 40,
      refusals: 0,
      passed: true,
    });
  });

  it("fails a session in which no lock ran, though no notice showed", () => {
    // The banner's absence alone would read this as a lock held throughout.
    const verdict = judgeLock([], quiet, window);
    expect(verdict.passed).toBe(false);
    expect(verdict.problems).toEqual([
      "the editor was never granted its document lock",
      "the lock was renewed 0 time(s) in the session, fewer than the 20 its heartbeat makes at half rate",
    ]);
  });

  it("fails when renewals stop partway, below half the heartbeat's rate", () => {
    expect(judgeLock([claim, ...renewals(19)], quiet, window).passed).toBe(
      false
    );
    expect(judgeLock([claim, ...renewals(20)], quiet, window).passed).toBe(
      true
    );
  });

  it("fails a renewal the server refused, naming when", () => {
    const answers = [
      claim,
      ...renewals(40),
      { at: from + 300_000, method: "PATCH", answer: "lost" },
    ];
    expect(judgeLock(answers, quiet, window).problems).toEqual([
      'the lock\'s renewal was refused ("lost") 300 s into the session',
    ]);
  });

  it("fails a reading whose notice offers to take the document back", () => {
    const samples = [
      { minute: 4.2, lock: { text: "Your claim ended.", takeBack: true } },
    ];
    expect(
      judgeLock([claim, ...renewals(40)], samples, window).problems
    ).toEqual([
      'the editor lost its document lock at 4.2 min: "Your claim ended."',
    ]);
  });

  it("does not count answers from before or after the session", () => {
    const outside = [
      { at: from - 1000, method: "PATCH", answer: "lost" },
      { at: to + 1000, method: "PATCH", answer: "renewed" },
    ];
    const verdict = judgeLock(
      [claim, ...renewals(20), ...outside],
      quiet,
      window
    );
    expect(verdict).toMatchObject({ renewals: 20, refusals: 0, passed: true });
  });
});
