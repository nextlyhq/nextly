/**
 * Telling the application's verdict apart from the database's failure.
 *
 * Work running inside a transaction may throw to roll the write back — a
 * refused value, a denied permission. Such an error did not come from the
 * driver, and classifying it as a database error replaces the code and payload
 * the application chose with a generic one, so a caller that asked for a
 * refusal is handed an unexplained failure instead.
 *
 * The adapters cannot import the class that defines these errors — they sit
 * below it — so the test that matters is that recognition works through the
 * global symbol registry, which is the whole reason the brand takes that form.
 */
import { describe, expect, it } from "vitest";

import { isApplicationError } from "../types/error";

/** A branded error built the way a separate copy of the defining module would. */
function branded(): Error {
  const error = new Error("Validation failed.");
  Object.defineProperty(error, Symbol.for("nextly/NextlyError"), {
    value: true,
  });
  return error;
}

describe("isApplicationError", () => {
  it("recognises a branded error built from another module instance", () => {
    // The point of `Symbol.for`: two copies of the defining module — a
    // duplicated install, a bundler that did not dedupe — resolve the same
    // symbol, so the brand survives a package boundary that `instanceof` would
    // not.
    expect(isApplicationError(branded())).toBe(true);
  });

  it("recognises it through a prototype chain", () => {
    // Subclasses carry the brand by inheritance, which is how the legacy error
    // shims stay recognisable.
    class Derived extends Error {}
    const error = new Derived("nope");
    Object.setPrototypeOf(error, branded());
    expect(isApplicationError(error)).toBe(true);
  });

  it("does not claim an ordinary error", () => {
    // A driver error must still be classified: treating it as a verdict would
    // send raw driver text to a caller in place of a mapped database error.
    expect(isApplicationError(new Error("connection reset"))).toBe(false);
  });

  it("does not claim an error branded with a look-alike symbol", () => {
    // A symbol of the same DESCRIPTION from outside the registry is a different
    // symbol, so nothing outside Nextly can claim to be a Nextly error.
    const error = new Error("impostor");
    Object.defineProperty(error, Symbol("nextly/NextlyError"), { value: true });
    expect(isApplicationError(error)).toBe(false);
  });

  it("does not claim a value carrying the brand set to anything but true", () => {
    const error = new Error("half-branded");
    Object.defineProperty(error, Symbol.for("nextly/NextlyError"), {
      value: "yes",
    });
    expect(isApplicationError(error)).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "boom"],
    ["a number", 500],
  ])("does not claim %s", (_label, value) => {
    // A thrown non-object is legal JavaScript and reaches the same catch.
    expect(isApplicationError(value)).toBe(false);
  });
});
