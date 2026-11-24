/**
 * What `nextly migrate` names as applied before its data steps, which a refusal they make then
 * says stays applied (`refusalAfterWork`). What separates a correct answer from a broken one: a
 * broken one names only the migration files, so a run that applied none but repaired the core
 * schema, made translation tables or followed the workflows is told nothing was changed.
 */
import { describe, expect, it } from "vitest";

import {
  appliedBeforeDataSteps,
  EARLIER_RECORDS_MOVED,
} from "../stored-data-of-run";

describe("what applied before nextly migrate's data steps", () => {
  it("names the deploy work where no migration file applied", () => {
    const named = appliedBeforeDataSteps({
      recordsMoved: false,
      migrationsApplied: 0,
    });
    expect(named).toContain("deploy work");
    expect(named).toContain("the core schema's reconcile");
    expect(named).not.toContain("migration this run applied");
    expect(named).not.toContain(EARLIER_RECORDS_MOVED);
  });

  it("names the move of an earlier release's records, the files and the deploy work, in that order", () => {
    const named = appliedBeforeDataSteps({
      recordsMoved: true,
      migrationsApplied: 2,
    });
    const at = (text: string) => named.indexOf(text);
    expect(at(EARLIER_RECORDS_MOVED)).toBe(0);
    expect(at("the 2 migrations this run applied")).toBeGreaterThan(0);
    expect(at("deploy work")).toBeGreaterThan(
      at("the 2 migrations this run applied")
    );
  });
});
