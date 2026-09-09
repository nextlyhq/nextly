/**
 * The rule deciding which saved patterns an author may insert.
 *
 * Worth its own file because it is asked in a browser about data written by a
 * server, and both halves can be absent: the granularity a row declares is a
 * required field that a read hook may still remove.
 */
import { describe, expect, it } from "vitest";

import {
  PATTERN_GRANULARITIES,
  isInsertableGranularity,
} from "./library-contract";

describe("which granularities may be inserted", () => {
  it("accepts the ones that are part of a page", () => {
    // The positive control. Without it every assertion below is satisfied by a
    // predicate that refuses everything, which is the failure this file's own
    // fix could plausibly introduce.
    expect(isInsertableGranularity("element")).toBe(true);
    expect(isInsertableGranularity("group")).toBe(true);
    expect(isInsertableGranularity("section")).toBe(true);
  });

  it("refuses a whole page, which is a way to START one", () => {
    expect(isInsertableGranularity("page")).toBe(false);
  });

  it("refuses a MISSING granularity rather than assuming it is fine", () => {
    // The reachable case, and the one a `!== "page"` comparison got wrong. The
    // field is required, so absent means a read hook or a field-level read rule
    // removed it — and a page pattern whose granularity was stripped was then
    // offered for insertion inside the page it is meant to be.
    expect(isInsertableGranularity(undefined)).toBe(false);
    expect(isInsertableGranularity(null)).toBe(false);
    expect(isInsertableGranularity("")).toBe(false);
  });

  it("refuses a value it has never heard of", () => {
    expect(isInsertableGranularity("PAGE")).toBe(false);
    expect(isInsertableGranularity("hero")).toBe(false);
    expect(isInsertableGranularity(3)).toBe(false);
  });

  it("cannot be satisfied through the PROTOTYPE", () => {
    // A record indexed by an untrusted string reaches its prototype, and
    // `constructor` answers with a function, which is truthy. Membership of a
    // set is asked instead, so these are ordinary unknown values.
    expect(isInsertableGranularity("constructor")).toBe(false);
    expect(isInsertableGranularity("toString")).toBe(false);
    expect(isInsertableGranularity("__proto__")).toBe(false);
  });

  it("classifies every granularity the vocabulary declares", () => {
    // The vocabulary and the rule are two halves of one decision, and the
    // compiler already refuses a new granularity that nobody classified. This
    // says the same thing at runtime, so a vocabulary read from anywhere but a
    // literal cannot slip past: every declared value gets a real answer.
    for (const value of PATTERN_GRANULARITIES) {
      expect(typeof isInsertableGranularity(value)).toBe("boolean");
    }
    // And the two sides are not the same set, which is what makes the rule a
    // rule rather than a pass-through.
    const insertable = PATTERN_GRANULARITIES.filter(isInsertableGranularity);
    expect(insertable.length).toBeGreaterThan(0);
    expect(insertable.length).toBeLessThan(PATTERN_GRANULARITIES.length);
  });
});
