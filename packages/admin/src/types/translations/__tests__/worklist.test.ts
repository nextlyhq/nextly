// A URL value is a request, not a fact. These pin the one it is dangerous to
// believe: the SOURCE language, which the server accepts and answers nonsense
// for, confidently and without a hint that the language was the problem.
import { describe, it, expect } from "vitest";

import { resolveActiveTarget, worklistStateFrom } from "../worklist";

const TARGETS = ["es", "ar"];

describe("resolveActiveTarget", () => {
  it("refuses a language that is not a translation target", () => {
    // `en` here is the source. Nothing is ever "missing" in it, and everything
    // counts as "translated" — two confident answers, both meaningless.
    expect(resolveActiveTarget("en", TARGETS)).toBe("es");
  });

  it("honours a language that IS a target", () => {
    // The control. Falling back unconditionally would ignore every link anyone
    // ever saved.
    expect(resolveActiveTarget("ar", TARGETS)).toBe("ar");
  });

  it("answers with the first target when the URL names none", () => {
    expect(resolveActiveTarget(undefined, TARGETS)).toBe("es");
  });

  it("has no answer on a site with no targets", () => {
    // One language: a worklist that can never have a row. The component says
    // so; inventing a target here would send it querying for nothing.
    expect(resolveActiveTarget("en", [])).toBeUndefined();
  });
});

describe("worklistStateFrom", () => {
  it("falls back to the question this page exists for", () => {
    expect(worklistStateFrom("nonsense")).toBe("missing");
  });
});
