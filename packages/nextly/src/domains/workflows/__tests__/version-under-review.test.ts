/**
 * Which version of a part is under review, from each language's newest version number: a
 * language's own newest, and for the shared part the newest of any language.
 */
import { describe, expect, it } from "vitest";

import { versionUnderReview } from "../part-versions";

// English saved first, then Spanish, then a version with no language: the order the numbers say.
const NEWEST = new Map<string | null, number>([
  ["en", 3],
  ["es", 7],
  [null, 5],
]);

describe("versionUnderReview", () => {
  it("names a language's own newest version, not a later one of another language", () => {
    expect(versionUnderReview(NEWEST, "en")).toBe(3);
    expect(versionUnderReview(NEWEST, "es")).toBe(7);
  });

  it("names the shared part's newest of any language, not the newest without one", () => {
    expect(versionUnderReview(NEWEST, null)).toBe(7);
    // In whatever order the languages come.
    expect(versionUnderReview(new Map([...NEWEST].reverse()), null)).toBe(7);
  });

  it("names the newest without a language for a document kept in none", () => {
    expect(versionUnderReview(new Map([[null, 4]]), null)).toBe(4);
  });

  it("names none for a part never saved", () => {
    expect(versionUnderReview(NEWEST, "ar")).toBeUndefined();
    expect(versionUnderReview(new Map(), null)).toBeUndefined();
    expect(versionUnderReview(new Map(), "en")).toBeUndefined();
  });
});
