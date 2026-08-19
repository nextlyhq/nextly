import { describe, expect, it } from "vitest";

import {
  isIdempotencyError,
  isMissingColumnError,
} from "../sql-statement-utils";

describe("isMissingColumnError", () => {
  it("recognises the message each dialect uses", () => {
    expect(isMissingColumnError(new Error("no such column: draft_key"))).toBe(
      true
    );
    expect(
      isMissingColumnError(
        new Error("Key column 'draft_key' doesn't exist in table")
      )
    ).toBe(true);
    expect(
      isMissingColumnError(new Error('column "draft_key" does not exist'))
    ).toBe(true);
  });

  it("reads the cause, which is where the driver error lands", () => {
    const wrapped = new Error("Failed query: CREATE UNIQUE INDEX ...", {
      cause: new Error("no such column: draft_key"),
    });
    expect(isMissingColumnError(wrapped)).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    // The whole value of this predicate is that it stays narrow: an index that
    // fails for any other reason must still stop the reconcile.
    expect(isMissingColumnError(new Error("disk I/O error"))).toBe(false);
    expect(
      isMissingColumnError(new Error("UNIQUE constraint failed: t.c"))
    ).toBe(false);
    expect(isMissingColumnError(new Error("syntax error near INDEX"))).toBe(
      false
    );
  });

  it("is a different question from idempotency", () => {
    // Idempotency means the work is already done; this means its precondition
    // is not done yet. Conflating them would let a genuinely absent column pass
    // as an already-applied change.
    const missing = new Error("no such column: draft_key");
    expect(isIdempotencyError(missing)).toBe(false);

    const existing = new Error("index already exists");
    expect(isMissingColumnError(existing)).toBe(false);
  });
});
