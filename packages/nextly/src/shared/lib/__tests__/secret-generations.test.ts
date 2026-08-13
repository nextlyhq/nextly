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

  describe("secrets the comma form cannot express", () => {
    // `NEXTLY_SECRET` is an arbitrary string. Everything the comma form does
    // to make a plain list readable — splitting, trimming — is destructive for
    // some legal secret, and destroying one is silent: the derived key matches
    // no stored row, so an erasure reports success having reached nothing.

    it("round-trips a secret containing a comma", () => {
      // Torn into "old" and "with" and "commas" by the comma form, none of
      // which was ever a key. The JSON form delimits without guessing.
      expect(secretGenerations("current", '["old,with,commas"]')).toEqual([
        "current",
        "old,with,commas",
      ]);
    });

    it("preserves whitespace that is part of the key", () => {
      // Trimming here produces a DIFFERENT key, not a tidier one. HMAC does
      // not care that the spaces look accidental.
      expect(secretGenerations("current", '["  spaced  "]')).toEqual([
        "current",
        "  spaced  ",
      ]);
    });

    it("still drops empty entries in the JSON form", () => {
      // The zero-length-key hazard is not about spelling: `""` is a valid HMAC
      // key under which every address hashes alike, whichever form declared it.
      expect(secretGenerations("current", '["older","",""]')).toEqual([
        "current",
        "older",
      ]);
    });

    it("treats a secret that merely looks like JSON as one secret", () => {
      // The control that stops the JSON branch from swallowing ordinary
      // values. A bare number, a quoted string and an object all parse as JSON
      // and none of them is a list of secrets, so each must survive whole.
      expect(secretGenerations(undefined, "12345")).toEqual(["12345"]);
      expect(secretGenerations(undefined, '"quoted"')).toEqual(['"quoted"']);
      expect(secretGenerations(undefined, '{"a":1}')).toEqual(['{"a":1}']);
    });

    it("falls back to the comma form when the JSON is not string entries", () => {
      // An array of non-strings is not a secret list either. Coercing it would
      // invent keys; falling through keeps the value intact for a human to see.
      expect(secretGenerations(undefined, "[1,2]")).toEqual(["[1", "2]"]);
    });
  });
});
