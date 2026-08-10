// The `localized` request flag decides whether a schema apply runs an
// ENABLE or a DISABLE transition, and a disable restores the companion's
// columns onto the main table and archives it. Reading it with `=== true`
// makes every non-boolean — including the string "false", and the string
// "true" — mean disable, so a malformed request silently rewrites a
// localized entity's storage. Absent must stay distinguishable from false:
// callers fall back to the persisted flag on absence.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { readRequestLocalized } from "../request-localized";

describe("readRequestLocalized", () => {
  it("returns the boolean when one is given", () => {
    expect(readRequestLocalized({ localized: true })).toBe(true);
    expect(readRequestLocalized({ localized: false })).toBe(false);
  });

  it("returns undefined when the caller has no opinion", () => {
    // Absent, explicitly null, and a body without the key all mean "use the
    // persisted flag" — NOT "disable".
    expect(readRequestLocalized({})).toBeUndefined();
    expect(readRequestLocalized({ localized: undefined })).toBeUndefined();
    expect(readRequestLocalized({ localized: null })).toBeUndefined();
    expect(readRequestLocalized(undefined)).toBeUndefined();
    expect(readRequestLocalized(null)).toBeUndefined();
  });

  it("rejects non-booleans instead of coercing them to a disable", () => {
    for (const value of ["true", "false", 1, 0, {}, []]) {
      let thrown: unknown;
      try {
        readRequestLocalized({ localized: value });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(NextlyError);
      expect((thrown as NextlyError).logContext).toMatchObject({
        reason: "localized-not-boolean",
      });
    }
  });

  // The string "true" is the case that shows why coercion is not merely
  // sloppy: it reads as the OPPOSITE of what the caller wrote.
  it('does not read the string "true" as enabling', () => {
    expect(() => readRequestLocalized({ localized: "true" })).toThrow(
      NextlyError
    );
  });
});
