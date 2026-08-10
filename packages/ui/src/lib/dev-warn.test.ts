/**
 * The warning utility's own contract.
 *
 * Each rule here exists because breaking it makes the warnings worse than
 * useless: a warning on every frame of a drag trains people to ignore the
 * console, and a warning that throws turns a degraded label into a blank page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devWarnOnce, resetDevWarnings } from "./dev-warn";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("devWarnOnce", () => {
  it("says nothing while the requirement holds", () => {
    devWarnOnce(true, "should not appear");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the requirement is unmet, naming the kit", () => {
    // The prefix matters in a console shared with the host app's own output:
    // a bare sentence gives the reader nothing to search for.
    devWarnOnce(false, "a range needs a name per thumb");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[@nextlyhq/ui]");
    expect(String(warn.mock.calls[0][0])).toContain("a range needs a name");
  });

  it("emits the same message ONCE however many times it recurs", () => {
    // A control re-rendering through a scrub would otherwise emit this on
    // every frame, which buries the one line the developer needs to act on.
    for (let i = 0; i < 60; i++) devWarnOnce(false, "same message");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still reports a DIFFERENT defect after one has been emitted", () => {
    // Deduplication that silenced everything after the first warning would
    // hide the second defect entirely — the failure mode of a naive guard.
    devWarnOnce(false, "first defect");
    devWarnOnce(false, "second defect");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reports a defect without throwing, so a missing label degrades", () => {
    // The whole point is that an accessibility defect stays a defect rather
    // than becoming a blank page: warning must never be the more damaging of
    // the two outcomes.
    expect(() => devWarnOnce(false, "unmet requirement")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
