/**
 * Which secrets an install can still READ with.
 *
 * The list exists because rotating a secret does not move the values already
 * derived from it. Its failure modes are quiet rather than loud, so the cases
 * below are chosen for what they would silently produce rather than for
 * coverage: an empty entry becomes a zero-length key that hashes every input to
 * one value, and a duplicated secret does the same comparison twice on every
 * erasure.
 */

import { describe, expect, it } from "vitest";

import { secretGenerations } from "../secret-generations";

describe("the secrets an install can read with", () => {
  it("puts the current secret first", () => {
    // Newest first, because it matches the overwhelming majority of rows and a
    // caller comparing in order finds it without walking the retired ones.
    expect(secretGenerations("current", "older,oldest")).toEqual([
      "current",
      "older",
      "oldest",
    ]);
  });

  it("is just the current secret when nothing has been retired", () => {
    expect(secretGenerations("current", undefined)).toEqual(["current"]);
    expect(secretGenerations("current", "")).toEqual(["current"]);
  });

  it("drops empty entries rather than treating them as a key", () => {
    // The case that matters. A trailing comma is the likeliest way to write
    // this list, and a zero-length key is a VALID HMAC key — every address
    // would hash to the same value under it, colliding every recipient in the
    // table with every other. Silent, and catastrophic for a predicate that
    // decides whose rows get erased.
    expect(secretGenerations("current", "older,")).toEqual([
      "current",
      "older",
    ]);
    expect(secretGenerations("current", " , , ")).toEqual(["current"]);
  });

  it("trims surrounding whitespace", () => {
    // A list written across lines or after a comma-space is ordinary; a key
    // with a stray space is a DIFFERENT key and would match nothing.
    expect(secretGenerations("current", " older , oldest ")).toEqual([
      "current",
      "older",
      "oldest",
    ]);
  });

  it("is empty when no secret is configured at all", () => {
    // Only reachable outside production, where the unkeyed development digest
    // is used. Callers must handle it rather than assume a key exists.
    expect(secretGenerations(undefined, undefined)).toEqual([]);
  });

  it("keeps retired secrets when no current one is set", () => {
    expect(secretGenerations(undefined, "older")).toEqual(["older"]);
  });
});
