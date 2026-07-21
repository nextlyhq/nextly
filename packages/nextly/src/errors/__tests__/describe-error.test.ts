/**
 * Operator-facing error rendering.
 *
 * The point of `describeError` is that `NextlyError.message` is the PUBLIC
 * message by construction, so anything rendering a caught error with
 * `.message` shows the generic wire text. These pin that the structured
 * fields the wire withholds do reach an operator channel.
 */
import { describe, expect, it } from "vitest";

import { describeError, immediateMessage } from "../describe-error";
import { NextlyError } from "../nextly-error";

describe("describeError", () => {
  it("surfaces the code and cause a NextlyError hides behind its public message", () => {
    // The exact shape that made `nextly db:sync` print only "An unexpected
    // error occurred." while the real failure was a missing column.
    const err = NextlyError.internal({
      cause: new Error('Failed query: select "localized" from "x"'),
      logContext: { dbKind: "internal", dialect: "sqlite" },
    });

    const out = describeError(err);

    expect(out).toContain("INTERNAL_ERROR");
    expect(out).toContain("Failed query");
    expect(out).toContain("sqlite");
    // The public message alone is what the bug looked like.
    expect(out).not.toBe(err.publicMessage);
  });

  it("reaches the driver message at the bottom of a real database chain", () => {
    // The production shape is four deep: NextlyError -> DbError ->
    // DrizzleQueryError -> driver error. Only the deepest link names the
    // fault; every wrapper above it says "Failed query". A shallower walk
    // silently drops the one segment worth reading.
    const driver = new Error('no such column: "localized"');
    const drizzle = new Error("Failed query: select ...", { cause: driver });
    const dbError = new Error("Failed query: select ...", { cause: drizzle });
    const err = NextlyError.internal({ cause: dbError });

    expect(describeError(err)).toContain('no such column: "localized"');
  });

  it("collapses wrappers that echo the same message", () => {
    // DbError and DrizzleQueryError carry identical text; printing both
    // doubles an already-long line for no gain.
    const inner = new Error("Failed query: select ...");
    const outer = new Error("Failed query: select ...", { cause: inner });
    const err = NextlyError.internal({ cause: outer });

    const occurrences = describeError(err).split("Failed query").length - 1;
    expect(occurrences).toBe(1);
  });

  it("returns the plain message for an ordinary Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("includes an ordinary Error's cause chain", () => {
    const out = describeError(
      new Error("outer", { cause: new Error("inner") })
    );
    expect(out).toContain("outer");
    expect(out).toContain("inner");
  });

  it("renders non-Error throwables instead of reporting them as unexpected", () => {
    expect(describeError("just a string")).toBe("just a string");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError(42)).toBe("42");
    expect(describeError({ code: "E1" })).toBe('{"code":"E1"}');
  });

  it("never throws on a circular value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    // Falls back to the type tag rather than an unhelpful empty string.
    expect(describeError(circular)).toContain("Object");
  });

  it("is not safe as a branching predicate, which is why immediateMessage exists", () => {
    // Callers ask "is this the benign 'already exists' case?" by substring
    // match. A description concatenates the whole chain, so an unrelated
    // failure that merely WRAPS such a message would match and be swallowed.
    const wrapped = new Error("permission denied opening database", {
      cause: new Error('table "x" already exists'),
    });

    expect(describeError(wrapped)).toContain("already exists");
    expect(immediateMessage(wrapped)).not.toContain("already exists");
  });

  it("omits logContext when the description will be persisted", () => {
    // A terminal line is read once; a stored row outlives the incident and is
    // served back by the schema-journal endpoint, so the arbitrary identifiers
    // a log context carries do not belong in it. Code, message and cause do.
    const err = NextlyError.internal({
      cause: new Error("no such column: localized"),
      logContext: { table: "dc_secret_project", dialect: "sqlite" },
    });

    const stored = describeError(err, { context: false });

    expect(stored).toContain("INTERNAL_ERROR");
    expect(stored).toContain("no such column: localized");
    expect(stored).not.toContain("dc_secret_project");
    // Default stays unchanged for terminal output.
    expect(describeError(err)).toContain("dc_secret_project");
  });

  it("does not stringify an object cause as [object Object]", () => {
    const err = NextlyError.internal({});
    Object.defineProperty(err, "cause", { value: { detail: "x" } });
    expect(describeError(err)).not.toContain("[object Object]");
  });
});
