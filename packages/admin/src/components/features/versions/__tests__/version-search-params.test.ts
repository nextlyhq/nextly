/**
 * Guards reading a comparison out of the address bar.
 *
 * The pair lives in the URL so it can be shared, which means anyone can type
 * it. These functions therefore treat the query as untrusted input: the
 * headline is that nothing a person can put in the address bar reaches a
 * request as a version number, and that arriving without a pair still shows
 * something useful rather than an error.
 */
import { describe, expect, it } from "vitest";

import { readVersionParam, resolvePair } from "../version-search-params";

describe("readVersionParam", () => {
  it("reads a version number", () => {
    expect(readVersionParam("7")).toBe(7);
  });

  it("takes the first value of a repeated parameter, as a browser does", () => {
    expect(readVersionParam(["3", "9"])).toBe(3);
  });

  it("rejects anything that is not a version number", () => {
    // Version numbers start at one, so zero and negatives are as meaningless
    // as a word and must not reach a request.
    for (const value of ["0", "-1", "1.5", "abc", "", "  ", "1e3abc"]) {
      expect(readVersionParam(value)).toBeUndefined();
    }
  });

  it("is undefined when the parameter is absent", () => {
    expect(readVersionParam(undefined)).toBeUndefined();
    expect(readVersionParam([])).toBeUndefined();
  });
});

describe("resolvePair", () => {
  it("takes the pair the URL names", () => {
    expect(resolvePair([9, 8, 7], 7, 9)).toEqual({ from: 7, to: 9 });
  });

  it("defaults to the two newest versions when the URL names none", () => {
    // Arriving without a pair is the ordinary case, and the most recent change
    // is what that reader came for.
    expect(resolvePair([9, 8, 7], undefined, undefined)).toEqual({
      from: 8,
      to: 9,
    });
  });

  it("honours a named pair that is not in the loaded page of history", () => {
    // History is paginated. Refusing an older pair because it has not been
    // fetched yet would break exactly the shared link this supports; the
    // request that follows is what decides whether those versions exist.
    expect(resolvePair([9, 8], 2, 3)).toEqual({ from: 2, to: 3 });
  });

  it("refuses when only one half is named, rather than inventing the other", () => {
    expect(resolvePair([9, 8], 5, undefined)).toEqual({ from: 8, to: 9 });
    expect(resolvePair([9, 8], undefined, 5)).toEqual({ from: 8, to: 9 });
  });

  it("has nothing to compare with a single version", () => {
    expect(resolvePair([1], undefined, undefined)).toBeNull();
    expect(resolvePair([], undefined, undefined)).toBeNull();
  });
});
