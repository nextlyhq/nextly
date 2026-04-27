// Tests for the IPC token utility used by the wrapper <-> child auth layer.
import { describe, expect, it } from "vitest";

import { generateIpcToken, validateIpcToken } from "./ipc-token.js";

describe("ipc-token", () => {
  it("generates a token of at least 32 characters", () => {
    const token = generateIpcToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("generates different tokens each call", () => {
    const a = generateIpcToken();
    const b = generateIpcToken();
    expect(a).not.toBe(b);
  });

  it("validates identical tokens as matching", () => {
    const token = generateIpcToken();
    expect(validateIpcToken(token, token)).toBe(true);
  });

  it("rejects mismatched tokens of equal length", () => {
    const a = "a".repeat(32);
    const b = "b".repeat(32);
    expect(validateIpcToken(a, b)).toBe(false);
  });

  it("rejects length-mismatched tokens", () => {
    expect(validateIpcToken("a".repeat(32), "a".repeat(33))).toBe(false);
  });

  it("rejects empty or null tokens", () => {
    expect(validateIpcToken("", "a".repeat(32))).toBe(false);
    expect(validateIpcToken("a".repeat(32), "")).toBe(false);
    expect(validateIpcToken(null, "a".repeat(32))).toBe(false);
    expect(validateIpcToken(undefined, "a".repeat(32))).toBe(false);
  });

  it("rejects tokens shorter than minimum length", () => {
    const shortToken = "abc";
    expect(validateIpcToken(shortToken, shortToken)).toBe(false);
  });
});
