// F14 v1 — `shouldLogF14HintReceipt` unit tests.
//
// v1 reserves the `hints` payload field on /collections/schema/{slug}/apply.
// The dispatcher logs a debug-level receipt when actionable hints are
// supplied (non-empty renames map). This test pins that decision
// surface so the v2 implementation can replace the body without
// silently flipping the v1 contract.

import { describe, expect, it } from "vitest";

import { shouldLogF14HintReceiptForTest } from "../collection-dispatcher";

describe("shouldLogF14HintReceipt (F14 v1)", () => {
  it("returns false for undefined", () => {
    expect(shouldLogF14HintReceiptForTest(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(shouldLogF14HintReceiptForTest(null)).toBe(false);
  });

  it("returns false for an empty hints object", () => {
    expect(shouldLogF14HintReceiptForTest({})).toBe(false);
  });

  it("returns false when renames is missing", () => {
    expect(shouldLogF14HintReceiptForTest({ other: "field" })).toBe(false);
  });

  it("returns false when renames is null", () => {
    expect(shouldLogF14HintReceiptForTest({ renames: null })).toBe(false);
  });

  it("returns false when renames is empty", () => {
    expect(shouldLogF14HintReceiptForTest({ renames: {} })).toBe(false);
  });

  it("returns true when renames has at least one entry", () => {
    expect(
      shouldLogF14HintReceiptForTest({ renames: { title: "name" } })
    ).toBe(true);
  });

  it("returns true for multiple rename pairs", () => {
    expect(
      shouldLogF14HintReceiptForTest({
        renames: { title: "name", body: "content" },
      })
    ).toBe(true);
  });

  it("returns false for non-object hints (defensive)", () => {
    expect(shouldLogF14HintReceiptForTest("string")).toBe(false);
    expect(shouldLogF14HintReceiptForTest(123)).toBe(false);
    expect(shouldLogF14HintReceiptForTest([])).toBe(false);
  });
});
