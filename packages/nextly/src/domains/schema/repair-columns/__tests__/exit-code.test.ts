/**
 * The four exit codes, and the order that picks one when more than one result holds: could not
 * run, then failed or interrupted, then differences remain.
 */
import { describe, expect, it } from "vitest";

import { REPAIR_COLUMNS_EXIT, repairColumnsExitCode } from "../exit-code";
import { OUTCOME_ORDER, type Outcome } from "../outcome";

describe("repairColumnsExitCode", () => {
  it("gives each result its own documented code", () => {
    expect(REPAIR_COLUMNS_EXIT).toEqual({
      noDifference: 0,
      couldNotRun: 1,
      differencesRemain: 2,
      failedOrInterrupted: 3,
    });
  });

  it("exits 0 when nothing was reported, or every column was converted", () => {
    expect(repairColumnsExitCode([])).toBe(0);
    expect(repairColumnsExitCode(["converted", "converted"])).toBe(0);
  });

  it("exits 1 when the command could not run", () => {
    expect(repairColumnsExitCode("could-not-run")).toBe(1);
  });

  // Every outcome other than converted, failed and interrupted is a difference that remains, a
  // column that could not be read included: CI never passes on a column nobody checked.
  it.each(
    OUTCOME_ORDER.filter(
      (o): o is Outcome =>
        o !== "converted" && o !== "failed" && o !== "interrupted"
    )
  )("exits 2 when a column is %s", outcome => {
    expect(repairColumnsExitCode([outcome])).toBe(2);
    expect(repairColumnsExitCode(["converted", outcome])).toBe(2);
  });

  it.each(["failed", "interrupted"] as const)(
    "exits 3 when a column is %s, over any difference that remains",
    outcome => {
      expect(repairColumnsExitCode([outcome])).toBe(3);
      for (const other of OUTCOME_ORDER) {
        expect(repairColumnsExitCode([other, outcome])).toBe(3);
        expect(repairColumnsExitCode([outcome, other])).toBe(3);
      }
    }
  );
});
