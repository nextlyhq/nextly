/**
 * The admin's password forms judge by the rule the server publishes: its
 * minimum, and its hasher's byte limit or none, in place of core's defaults.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  parsePasswordRule,
  resetPasswordRule,
  setPasswordRule,
} from "./password-rule";
import { passwordSchema } from "./password-schema";

/** 80 bytes: past bcrypt's 72. */
const LONG = `Str0ng-P@ss-${"x".repeat(68)}`;

afterEach(() => resetPasswordRule());

describe("the password rule the server publishes", () => {
  it("takes a password past 72 bytes where the app's hasher reads it whole", () => {
    // The control: core's defaults refuse it.
    expect(passwordSchema.safeParse(LONG).success).toBe(false);
    setPasswordRule({ minLength: 8, maxBytes: null });
    expect(passwordSchema.safeParse(LONG).success).toBe(true);
  });

  it("refuses past the hasher's own limit, with its number", () => {
    setPasswordRule({ minLength: 8, maxBytes: 16 });
    const verdict = passwordSchema.safeParse("Str0ng-P@ssw0rd!-and-more");
    expect(verdict.error?.issues.map(issue => issue.message)).toEqual([
      "Password exceeds the 16-byte limit of the password digester.",
    ]);
  });

  it("judges by the configured minimum", () => {
    setPasswordRule({ minLength: 12, maxBytes: 72 });
    const verdict = passwordSchema.safeParse("Str0ng-Pass");
    expect(verdict.error?.issues.map(issue => issue.message)).toEqual([
      "Password must be at least 12 characters",
    ]);
  });

  it("reads only a well-formed rule from the answer", () => {
    expect(parsePasswordRule({ minLength: 12, maxBytes: null })).toEqual({
      minLength: 12,
      maxBytes: null,
    });
    expect(parsePasswordRule({ minLength: 8, maxBytes: 72 })).toEqual({
      minLength: 8,
      maxBytes: 72,
    });
    // An older server says nothing; a malformed rule is not taken.
    for (const value of [
      undefined,
      null,
      {},
      { minLength: 0, maxBytes: 72 },
      { minLength: 8, maxBytes: -1 },
      { minLength: 8, maxBytes: "72" },
      { minLength: 8.5, maxBytes: 72 },
    ]) {
      expect(parsePasswordRule(value)).toBeNull();
    }
  });
});
