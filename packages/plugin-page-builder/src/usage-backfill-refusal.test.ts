/**
 * Which incomplete walks leave a scope outstanding, and which record it anyway.
 *
 * The distinction is not "did the walk finish" — it is whether what went wrong
 * LEFT A TRACE. A missing row is indistinguishable from a document that
 * references nothing, so a scope recorded over one is recorded over a hole
 * nobody can see. A document that could not be read whole leaves an
 * `unreadable` marker, and the health reader reads those, so the index reports
 * itself incomplete whether or not the scope was recorded.
 *
 * Getting that backwards costs more than the defect it fixes, and this file
 * exists because it was got backwards once: exceeding a walk bound is
 * DETERMINISTIC, so refusing it means the scope can never be recorded and the
 * sweep rescans the whole collection on every drain, for ever — a backfill that
 * cannot finish, monopolising a queue it shares with every other job.
 *
 * The DECISION is tested rather than the wiring around it. Driving this through
 * `usageBackfillDeps` would run a real rebuild against a fake database, which
 * answers a clean report whatever the case intended — a fixture that never
 * reaches the mechanism it names.
 *
 * @module usage-backfill-refusal.test
 */
import { describe, expect, it } from "vitest";

import type { ClassUsageRebuildReport } from "./class-usage-index-rebuild";
import { refuseIncompleteWalk } from "./usage-backfill-wiring";

const CLEAN: ClassUsageRebuildReport = {
  scanned: 3,
  repaired: 0,
  removed: 0,
  undetermined: 0,
  unrepaired: 0,
};

const SCOPE = {
  entity: "pages",
  field: "content",
  locale: "",
  variant: "published",
} as const;

describe("deciding whether a walk may be recorded", () => {
  it("RECORDS a scope whose documents could not be read whole", () => {
    // The marker is what keeps the answer honest, so recording is safe — and
    // necessary. Exceeding a bound is deterministic, so refusing here means the
    // scope is never recorded and every drain rescans the collection.
    expect(() =>
      refuseIncompleteWalk(SCOPE, { ...CLEAN, undetermined: 2 })
    ).not.toThrow();
  });

  it("REFUSES a scope whose rows could not be brought into agreement", () => {
    // `unrepaired` leaves no trace: a missing row is indistinguishable from a
    // document that references nothing, so recording it hides a hole.
    expect(() =>
      refuseIncompleteWalk(SCOPE, { ...CLEAN, unrepaired: 1 })
    ).toThrow(/unrepaired/);
  });

  it("REFUSES a scope whose store rejected, and keeps the cause", () => {
    // The cause travels, because "the backfill refused" without saying what the
    // database said is a report nobody can act on.
    const failure = new Error("the database went away");

    expect(() => refuseIncompleteWalk(SCOPE, { ...CLEAN, failure })).toThrow(
      /could not walk/
    );
    try {
      refuseIncompleteWalk(SCOPE, { ...CLEAN, failure });
    } catch (thrown) {
      expect((thrown as { cause?: unknown }).cause).toBe(failure);
    }
  });

  it("records a clean walk", () => {
    // The control: without it, "refuses everything" satisfies both cases above.
    expect(() => refuseIncompleteWalk(SCOPE, CLEAN)).not.toThrow();
  });

  it("names the scope it refused, so a log says WHICH work is outstanding", () => {
    // A refusal that does not say where is one nobody can follow up: the sweep
    // retries silently and the site looks merely slow.
    expect(() =>
      refuseIncompleteWalk(
        { ...SCOPE, locale: "fr", variant: "draft" },
        { ...CLEAN, unrepaired: 1 }
      )
    ).toThrow(/pages\.content \(fr, draft\)/);
  });
});
