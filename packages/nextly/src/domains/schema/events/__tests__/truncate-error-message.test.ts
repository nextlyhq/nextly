/**
 * The `error_message` column bound.
 *
 * This guard exists so that recording a failure cannot itself fail. A helper
 * that returns more than the bound defeats that entirely, and does so at the
 * one moment it is needed.
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_MESSAGE_MAX_LEN,
  truncateErrorMessage,
} from "../schema-events-repository";

describe("truncateErrorMessage", () => {
  it("never returns more than the column bound", () => {
    // The regression: slicing to the full bound and then appending "..."
    // returned bound + 3 characters.
    for (const length of [
      ERROR_MESSAGE_MAX_LEN - 1,
      ERROR_MESSAGE_MAX_LEN,
      ERROR_MESSAGE_MAX_LEN + 1,
      ERROR_MESSAGE_MAX_LEN * 4,
    ]) {
      const out = truncateErrorMessage("x".repeat(length));
      expect(out.length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX_LEN);
    }
  });

  it("leaves a message at exactly the bound untouched", () => {
    const exact = "x".repeat(ERROR_MESSAGE_MAX_LEN);
    expect(truncateErrorMessage(exact)).toBe(exact);
  });

  it("marks a message that was cut", () => {
    expect(truncateErrorMessage("x".repeat(ERROR_MESSAGE_MAX_LEN + 1))).toMatch(
      /\.\.\.$/
    );
  });

  it("handles an absent message, which optional error fields produce", () => {
    expect(truncateErrorMessage(undefined)).toBe("");
    expect(truncateErrorMessage("")).toBe("");
  });
});
