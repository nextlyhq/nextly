/**
 * The refusal of a write that must commit on its own, made while the calling
 * flow has a transaction open. What decides "open" is each adapter's, proved
 * on every dialect in `open-transaction.integration.test.ts`; this covers the
 * refusal itself.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { assertNoOpenTransaction } from "../open-transaction";

/** An adapter that answers `open` for the calling flow. */
function adapterWith(open: boolean) {
  return { transactionOpenInFlow: () => open };
}

describe("assertNoOpenTransaction", () => {
  it("lets the call through when the calling flow has no transaction open", () => {
    expect(() =>
      assertNoOpenTransaction(adapterWith(false), "a count")
    ).not.toThrow();
  });

  it("refuses with an internal error, its detail in the log only", () => {
    let refusal: unknown;
    try {
      assertNoOpenTransaction(adapterWith(true), "a count");
    } catch (error) {
      refusal = error;
    }

    expect(NextlyError.isCode(refusal, "INTERNAL_ERROR")).toBe(true);
    if (!NextlyError.is(refusal)) return;
    expect(refusal.publicMessage).toBe("An unexpected error occurred.");
    expect(refusal.logContext).toEqual({ operation: "a count" });
    expect(refusal.logMessage).toContain(
      "a count was called inside an open transaction"
    );
  });
});
