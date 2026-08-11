// The apply path's conversions must stay inside what the convertibility probe can speak for.
//
// Two independent things keep a repaired column safe. The probe answers whether the stored values
// survive the cast, and it answers that over rows which are NOT NULL — correct for a cast, wrong for
// a NOT NULL. So the guarantee also depends on the apply path never emitting a statement the probe's
// question does not cover.
//
// `executePreResolutionOps` secures that by calling `conversionForRename` WITHOUT a context, since
// every nullability and default statement the function can emit is gated on one. That is a coupling
// between two files held by an omitted argument, and this pins it.
//
// 🔴 This test would have been vacuous a day ago: nothing could emit a nullability change, so it
// would have passed no matter what the code did — the fixture-never-reaches-the-mechanism failure.
// It has teeth now because `conversionForRename` genuinely emits `change_column_nullable` when it is
// given a context, which the second case below proves. A future context added at the executor's call
// site fails here, at build time, instead of reaching a customer's migration.

import { describe, expect, it, vi } from "vitest";

import type { RenameColumnOp } from "../../diff/types";
import { conversionForRename } from "../../rename-conversion";
import { COVERED_CONVERSIONS, executePreResolutionOps } from "../executor";

// Spied rather than replaced: the executor gets the real behaviour, and the arguments it passes
// become observable. Asserting on those is the difference between checking the call site and
// checking a copy of it — a test that rebuilt the argument list itself would keep passing after
// someone changed the line it exists to watch.
vi.mock("../../rename-conversion", async () => {
  const actual = await vi.importActual<
    typeof import("../../rename-conversion")
  >("../../rename-conversion");
  return { ...actual, conversionForRename: vi.fn(actual.conversionForRename) };
});

const rename: RenameColumnOp = {
  type: "rename_column",
  tableName: "posts",
  fromColumn: "_body",
  toColumn: "body",
  fromType: "text",
  toType: "jsonb",
};

// Read as plain strings. Compared at their literal types, TypeScript resolves the second case's
// assertion statically and rejects it as a comparison that can never hold — which is a fair
// complaint about the expression and not about the property, since what is being checked is the
// CONTENTS of the list rather than its type.
const covered: readonly string[] = COVERED_CONVERSIONS;

describe("the conversions the apply path can emit", () => {
  it("stay within what the probe covers, on every dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      // Called exactly as `executePreResolutionOps` calls it: no context.
      const emitted = conversionForRename(rename, dialect).map(c => c.type);
      const outside = emitted.filter(type => !covered.includes(type));
      expect(
        outside,
        `${dialect} emitted a statement the probe cannot cover`
      ).toEqual([]);
    }
  });

  it("leave that set as soon as a context is supplied — the positive control", () => {
    // Without this the test above proves only that the current call emits nothing uncovered, which a
    // function that could NEVER emit anything uncovered would also satisfy. This shows the boundary
    // is one argument away, so the assertion above is about the call and not about the callee.
    const emitted = conversionForRename(rename, "postgresql", {
      source: { nullable: true },
      target: { nullable: false },
    }).map(c => c.type);

    expect(emitted).toContain("change_column_nullable");
    expect(
      covered,
      "and it is deliberately outside the covered set"
    ).not.toContain("change_column_nullable");
  });

  it("is asked for those conversions WITHOUT a context, by the executor itself", async () => {
    // Observed at the real call site. `conversionForRename` emits nullability and default statements
    // only when it is given a context, so the executor withholding one is what keeps the emitted set
    // inside the probe's domain. Supplying a context there is a one-word edit with no local symptom,
    // and this is what turns it into a failing build.
    const spy = vi.mocked(conversionForRename);
    spy.mockClear();

    // Records instead of executing: the probe's SELECT resolves to no rows, so the column reads as
    // convertible and the executor proceeds to the statements under test.
    const statements: unknown[] = [];
    const handle = {
      execute: (query: unknown) => {
        statements.push(query);
        return Promise.resolve({ rows: [] });
      },
    };

    await executePreResolutionOps(handle, [rename], "postgresql");

    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(
        call[2],
        "the executor must not hand conversionForRename a context"
      ).toBeUndefined();
    }
  });
});
