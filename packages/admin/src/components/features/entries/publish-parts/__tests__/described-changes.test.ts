/**
 * What a refused publish says changed: each part chosen that did, by name, and otherwise that it
 * was something else. The plausible broken one names every part chosen, or a part whose mark did
 * not move.
 */
import { describe, expect, it } from "vitest";

import type { PartMarks } from "@admin/services/publishParts";

import { changedSinceDescribed, sameMarks } from "../described-changes";

const BEFORE: PartMarks = {
  languages: { en: "e1", es: "s1" },
  shared: "h1",
};
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish" })[code] ?? code;

const said = (
  now: Partial<PartMarks>,
  before: PartMarks = BEFORE,
  direction: "publish" | "unpublish" = "publish"
) =>
  changedSinceDescribed({
    before,
    now: { ...before, ...now },
    direction,
    labelOf,
  });

describe("what changed since the parts were described", () => {
  it("names the one chosen part that changed", () => {
    expect(said({ languages: { en: "e1", es: "s2" } })).toBe(
      "Spanish changed since this was shown. Check what each part does now, then publish again."
    );
    expect(said({ shared: "h2" })).toMatch(/^The shared fields changed since/);
  });

  it("names every chosen part that changed, and none that did not", () => {
    expect(said({ languages: { en: "e2", es: "s2" }, shared: "h2" })).toMatch(
      /^English, Spanish and the shared fields changed since/
    );
    expect(said({ languages: { en: "e2", es: "s2" } })).toMatch(
      /^English and Spanish changed since/
    );
  });

  it("names a part that is no longer described", () => {
    expect(said({ languages: { en: "e1" } })).toMatch(/^Spanish changed since/);
  });

  it("names the shared fields though they were not chosen", () => {
    expect(said({ shared: "h2" })).toMatch(/^The shared fields changed since/);
  });

  it("says it was something else where nothing marked changed", () => {
    expect(said({})).toMatch(/^Something else in this document changed since/);
  });

  it("says to unpublish again where that was refused", () => {
    expect(said({}, BEFORE, "unpublish")).toMatch(/then unpublish again\.$/);
  });

  it("tells marks that differ in any part, or in the parts described", () => {
    expect(sameMarks(BEFORE, { ...BEFORE })).toBe(true);
    for (const now of [
      { ...BEFORE, shared: "h2" },
      { ...BEFORE, languages: { en: "e1" } },
      { ...BEFORE, languages: { ...BEFORE.languages, fr: "f1" } },
    ]) {
      expect(sameMarks(BEFORE, now)).toBe(false);
    }
  });
});
