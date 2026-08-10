import { describe, it, expect } from "vitest";
import { NextlyError } from "../nextly-error";
import { statusToErrorCode } from "../error-codes";

/**
 * `BUSINESS_RULE_VIOLATION` carries its status canonically rather than at each
 * throw site. Both directions are pinned because they are independent: the
 * code -> status map is what a thrown error answers with, while status -> code
 * is what a legacy envelope carrying a bare 422 resolves to. Adding the first
 * must not move the second.
 */
describe("BUSINESS_RULE_VIOLATION canonical status", () => {
  it("answers 422 without an inline statusCode", () => {
    const e = new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage: "x",
    });
    expect(e.statusCode).toBe(422);
  });

  it("does NOT change the status -> code direction", () => {
    // The trap: adding a code->status entry must not make 422 resolve back to
    // BUSINESS_RULE_VIOLATION, which would change what a legacy envelope means.
    expect(statusToErrorCode(422)).toBe("INVALID_INPUT");
  });
});
