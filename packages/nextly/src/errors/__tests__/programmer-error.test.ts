/**
 * Our defects versus the caller's mistakes.
 *
 * A service that maps every throwable onto one fallback status reports its own
 * crashes as the caller's fault. These pin which natives count as ours, and
 * more importantly which do not.
 */
import { describe, expect, it } from "vitest";

import { isProgrammerError } from "../programmer-error";

describe("isProgrammerError", () => {
  it("treats a bad property access as our defect", () => {
    // The exact failure that surfaced to the API as "Validation failed": a
    // service read `.toLowerCase()` off an undefined field.
    let caught: unknown;
    try {
      const value = undefined as unknown as { name: string };
      value.name.toLowerCase();
    } catch (error) {
      caught = error;
    }
    expect(isProgrammerError(caught)).toBe(true);
  });

  it("treats an unbound identifier as our defect", () => {
    const err = new ReferenceError("x is not defined");
    expect(isProgrammerError(err)).toBe(true);
  });

  it("does NOT claim a malformed JSON body", () => {
    // JSON.parse on a caller-supplied payload throws SyntaxError. Calling that
    // our bug would turn a genuine 400 into a 500.
    let caught: unknown;
    try {
      JSON.parse("{ not json");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SyntaxError);
    expect(isProgrammerError(caught)).toBe(false);
  });

  it("does NOT claim a caller-supplied out-of-range value", () => {
    expect(isProgrammerError(new RangeError("Invalid array length"))).toBe(
      false
    );
  });

  it("does not claim ordinary errors or non-Error throwables", () => {
    expect(isProgrammerError(new Error("expected failure"))).toBe(false);
    expect(isProgrammerError("string")).toBe(false);
    expect(isProgrammerError(null)).toBe(false);
    expect(isProgrammerError(undefined)).toBe(false);
  });
});
