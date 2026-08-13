/**
 * Which secrets an install can still READ with.
 *
 * The list exists because rotating a secret does not move the values already
 * derived from it. Its failure modes are quiet rather than loud, so the cases
 * below are chosen for what they would silently produce rather than for
 * coverage: an entry lost to splitting or trimming yields a key that was
 * never used, and a duplicated secret does the same comparison twice on every
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
    // A trailing comma is the likeliest way to write this list, and nothing
    // about `older,` says the author meant a second key. Dropping it here is
    // about INTENT, not about the key being dangerous: an empty HMAC key is
    // perfectly well defined and does NOT collide addresses — measured, two
    // addresses under `""` give different digests. The JSON form keeps `""`
    // for exactly that reason.
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

    it("keeps an empty entry in the JSON form, and only there", () => {
      // The two forms differ on `""` deliberately. In the comma form it is
      // almost always a trailing comma, so it goes. Writing it inside a JSON
      // array is an explicit act, and it names a real generation: an install
      // that ran with `NEXTLY_SECRET=""` keyed its digests with the empty
      // string, because the writer takes the unkeyed branch only for
      // `undefined`. Dropping it strands every row that install wrote.
      expect(secretGenerations("current", '["older",""]')).toEqual([
        "current",
        "older",
        "",
      ]);
      expect(secretGenerations("current", "older,")).toEqual([
        "current",
        "older",
      ]);
    });

    it("names the unkeyed generation with null", () => {
      // The generation no string can denote: rows written before the install
      // had any secret carry a plain SHA-256 digest, which no HMAC under any
      // key reproduces. Without a spelling for it, enabling a secret makes
      // those rows permanently unreachable by a lookup or an erasure.
      expect(secretGenerations("current", '[null,"older"]')).toEqual([
        "current",
        undefined,
        "older",
      ]);
    });

    it("rejects a JSON array holding anything but secrets", () => {
      // Numbers are not keys, and coercing them would invent generations. The
      // value falls through to the comma form intact instead.
      expect(secretGenerations(undefined, "[1,2]")).toEqual(["[1", "2]"]);
    });

    it("treats a secret that merely looks like JSON as one secret", () => {
      // The control that stops the JSON branch from swallowing ordinary
      // values. A bare number, a quoted string and an object all parse as JSON
      // and none of them is a list of secrets, so each must survive whole.
      expect(secretGenerations(undefined, "12345")).toEqual(["12345"]);
      expect(secretGenerations(undefined, '"quoted"')).toEqual(['"quoted"']);
      expect(secretGenerations(undefined, '{"a":1}')).toEqual(['{"a":1}']);
    });
  });
});
