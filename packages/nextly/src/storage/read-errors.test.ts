/**
 * That the over-cap refusal is a CANONICAL error, not a free-form string.
 *
 * `NextlyError` accepts any code, so an unregistered one compiles, constructs
 * and reads correctly at every call site — and then falls back to HTTP 500 if
 * it ever escapes to a response, turning a 413 the caller could act on into an
 * opaque server error. Measured: deleting the registration produces ZERO
 * typecheck errors, so nothing but this file notices.
 *
 * Asserted through the STATUS the class actually carries rather than by looking
 * the literal up in the table. A test that checked the table would be comparing
 * one literal against another; this fails for the reason the registration
 * exists, which is the only reason it is worth having.
 *
 * @module storage/read-errors.test
 */
import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../errors/error-codes";
import { isStorageReadTooLarge, StorageReadTooLargeError } from "./read-errors";

describe("the over-cap refusal", () => {
  it("carries 413, which it can only get from the canonical table", () => {
    const error = new StorageReadTooLargeError("media/big.pdf", 100, 900);
    expect(error.statusCode).toBe(413);
    // Not 500: the fallback an unregistered code silently receives, and the
    // outcome this registration exists to prevent.
    expect(error.statusCode).not.toBe(500);
  });

  it("is registered under its own code rather than borrowing another", () => {
    /*
     * `SIZE_EXCEEDED` is also 413 and was the tempting reuse. It refuses an
     * upload the caller is SENDING; this refuses to buffer an object already
     * stored. Kept apart because `isStorageReadTooLarge` keys on the code — one
     * shared code would make the predicate match upload-validation failures
     * too, and the attachment path would answer them with the wrong sentence.
     */
    expect(NEXTLY_ERROR_STATUS.STORAGE_READ_TOO_LARGE).toBe(413);
    expect(new StorageReadTooLargeError("p", 1).code).toBe(
      "STORAGE_READ_TOO_LARGE"
    );
  });

  it("keeps the numbers where a caller can read them", () => {
    // The cap and the size travel as fields, so a caller can say what the limit
    // was without parsing prose — and the path stays out of the public message.
    const error = new StorageReadTooLargeError("media/big.pdf", 100, 900);
    expect(error.maxBytes).toBe(100);
    expect(error.size).toBe(900);
    expect(error.publicMessage).not.toContain("media/big.pdf");
  });

  it("recognises its own instances and nothing else", () => {
    expect(isStorageReadTooLarge(new StorageReadTooLargeError("p", 1))).toBe(
      true
    );
    // The control: a predicate returning true for everything would satisfy the
    // positive case while telling the attachment path that every failure is a
    // size problem.
    expect(isStorageReadTooLarge(new Error("nope"))).toBe(false);
    expect(isStorageReadTooLarge("nope")).toBe(false);
  });
});
