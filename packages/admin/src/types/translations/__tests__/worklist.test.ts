// A URL value is a request, not a fact. These pin the one it is dangerous to
// believe: the SOURCE language, which the server accepts and answers nonsense
// for, confidently and without a hint that the language was the problem.
import { describe, it, expect } from "vitest";

import {
  LANGUAGE_STATES,
  LANGUAGE_STATE_LABEL,
} from "@admin/components/features/entries/translation-meta";

import {
  WORKLIST_STATES,
  resolveActiveTarget,
  worklistStateFrom,
} from "../worklist";

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

describe("WORKLIST_STATES", () => {
  it("offers exactly the states a language can be in — no more, no fewer", () => {
    // Derived from the canonical catalog rather than restated. A state added
    // or removed there must not leave this page with a tab that matches
    // nothing, or missing one a translator needs.
    expect([...WORKLIST_STATES.map(s => s.value)].sort()).toEqual(
      [...LANGUAGE_STATES].sort()
    );
  });

  it("uses the language panel's own wording for each", () => {
    // A worklist with a vocabulary of its own would describe the same document
    // differently depending on which screen asked.
    for (const { value, label } of WORKLIST_STATES) {
      expect(label.toLowerCase()).toBe(LANGUAGE_STATE_LABEL[value]);
    }
  });

  it("leads with the question this page exists to answer", () => {
    // The one thing that IS this page's own: the language panel reads
    // best-to-worst, a worklist reads worst-first.
    expect(WORKLIST_STATES[0]?.value).toBe("missing");
  });
});
