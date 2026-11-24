/**
 * The start-up check fails a command whose code loads too slowly.
 *
 * The runs are handed over here, since the real ones need a built CLI and
 * take minutes; what is judged is the check's own judgement of them.
 *
 * What would separate a limit that holds from one that does not:
 * - a command over the limit passed, or one at or under it failed;
 * - the judgement made of one run, or of their mean, so one slow run of a fast
 *   command fails it, or fast runs hide a slow command;
 * - a command within the limit passed although its modules could not be counted;
 * - an inline action, which loads nothing, let up to a command's limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_LOAD_LIMIT_MS, measureCodeLoad } from "./check-cli-startup.mjs";

let printed;
beforeEach(() => {
  printed = [];
  vi.spyOn(console, "log").mockImplementation(line => printed.push(line));
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** What the check says of a command whose five runs took `times`. */
function judged(times, { kind = "loaded", modules = { count: 700 } } = {}) {
  return measureCodeLoad(
    ["migrate:status"],
    {},
    {},
    {
      runs: () => ({ times, kind }),
      modules: () => modules,
    }
  );
}

const allAt = ms => [ms, ms, ms, ms, ms];

describe("a command's code load", () => {
  it("is limited to 2.5 s", () => {
    expect(CODE_LOAD_LIMIT_MS).toBe(2500);
  });

  it("fails the check over the limit, with its time and the limit", () => {
    const failure = judged(allAt(2501));
    expect(failure).toContain("nextly migrate:status");
    expect(failure).toContain("2501 ms");
    expect(failure).toContain("over 2500 ms");
    expect(printed.join("\n")).toMatch(/^FAIL +2501 ms +700 modules/);
  });

  it("passes it at the limit and under it, its time reported", () => {
    expect(judged(allAt(2500))).toBeUndefined();
    expect(judged(allAt(1600))).toBeUndefined();
    expect(printed.join("\n")).toMatch(/^ok +2500 ms.*\nok +1600 ms/);
  });

  it("is judged by the middle of its runs", () => {
    // Means of 3200 and 1800: each would be judged the other way by it.
    expect(judged([1000, 1000, 1000, 1000, 12000])).toBeUndefined();
    expect(judged([600, 600, 2600, 2600, 2600])).toContain("2600 ms");
  });

  it("fails within the limit where its modules could not be counted", () => {
    const failure = judged(allAt(1600), {
      modules: { failure: "the counting run wrote no module count" },
    });
    expect(failure).toContain("wrote no module count");
    expect(printed.join("\n")).toMatch(/^FAIL +1600 ms/);
  });

  it("gives both reasons where it is over the limit and was not counted", () => {
    const failure = judged(allAt(3000), {
      modules: { failure: "the counting run wrote no module count" },
    });
    expect(failure).toContain("over 2500 ms");
    expect(failure).toContain("wrote no module count");
  });

  it("is judged by the time it reports, in whole milliseconds", () => {
    expect(judged(allAt(2500.4))).toBeUndefined();
    expect(judged(allAt(2500.6))).toContain("2501 ms");
  });

  it("leaves an inline action to the answer-only budget", () => {
    expect(judged(allAt(600), { kind: "none" })).toContain("over 500 ms");
    expect(judged(allAt(400), { kind: "none" })).toBeUndefined();
  });
});
