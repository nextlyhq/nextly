import { describe, expect, it } from "vitest";

import { gateVerdict, skipIsAcceptable } from "./ci-gate.mjs";

const ok = (name = "ci") => ({ [name]: { result: "success" } });

describe("skipIsAcceptable", () => {
  it("is true only when the workflow said the commit is inert", () => {
    expect(skipIsAcceptable("true")).toBe(true);
  });

  it("is false for everything else, including an unset flag", () => {
    // 🔴 Reading a skipped job as a pass is how a gate stops gating, so the
    // ONE reason it is allowed has to be stated by the workflow rather than
    // inferred here. An absent flag is not that statement.
    for (const value of [undefined, "", "false", "TRUE", "1"]) {
      expect(skipIsAcceptable(value)).toBe(false);
    }
  });
});

describe("gateVerdict", () => {
  it("passes when every job succeeded", () => {
    expect(gateVerdict({ ...ok("ci"), ...ok("unit") }, "false")).toEqual({
      ok: true,
      reasons: [],
    });
  });

  it("fails on a failed job, and names it", () => {
    const verdict = gateVerdict(
      { ...ok("ci"), unit: { result: "failure" } },
      "false"
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual(["unit reported failure."]);
  });

  it("fails on a cancelled job", () => {
    // A cancelled job verified nothing, and a run cancelled midway is exactly
    // when a gate is most tempting to wave through.
    expect(gateVerdict({ unit: { result: "cancelled" } }, "false").ok).toBe(false);
  });

  it("fails on a skipped job when the commit is not inert", () => {
    const verdict = gateVerdict({ unit: { result: "skipped" } }, "false");
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain("did not run");
  });

  it("passes a skipped job only when the commit is inert", () => {
    // The one legitimate skip: `changes` decided the commit cannot affect
    // anything these jobs would have verified. Without this the branch could
    // never merge a docs-only change, because a required check that never
    // reports blocks for ever.
    expect(gateVerdict({ unit: { result: "skipped" } }, "true").ok).toBe(true);
  });

  it("refuses to pass when it depends on nothing", () => {
    // 🔴 The shape a mistyped `needs:` produces. A gate that needs nothing
    // agrees with everything, which is the failure it exists to prevent
    // wearing a green tick.
    const verdict = gateVerdict({}, "true");
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain("nothing to report");
  });

  it("refuses a result it does not recognise", () => {
    // The set of outcomes belongs to GitHub, not to this. A new one is not
    // assumed to be good news.
    const verdict = gateVerdict({ unit: { result: "neutral" } }, "false");
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain("does not know");
  });

  it("refuses a job with no result at all", () => {
    expect(gateVerdict({ unit: {} }, "false").ok).toBe(false);
  });

  it("names every failing job, not just the first", () => {
    const verdict = gateVerdict(
      { a: { result: "failure" }, b: { result: "cancelled" }, c: { result: "success" } },
      "false"
    );
    expect(verdict.reasons).toHaveLength(2);
  });
});
