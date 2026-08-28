// A URL value is a request, not a fact. These pin the one it is dangerous to
// believe: the SOURCE language, which the server accepts and answers nonsense
// for, confidently and without a hint that the language was the problem.
import { describe, it, expect } from "vitest";

import {
  LANGUAGE_STATES,
  LANGUAGE_STATE_LABEL,
  type LanguageState,
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
  it("offers a tab for every state a language can be in", () => {
    // Derived from the canonical catalog rather than restated. A state added or
    // removed there must not leave this page missing a tab a translator needs.
    const values = WORKLIST_STATES.map(s => s.value);
    for (const state of LANGUAGE_STATES) expect(values).toContain(state);
  });

  it("adds exactly ONE tab that is not a language state, and it is `stale`", () => {
    // 🔴 The asymmetry is the point, and it is asserted rather than tolerated.
    // A worklist tab is a QUESTION; a language state is a CLASSIFICATION, and
    // `languageState()` returns exactly one of them per locale. Staleness is
    // orthogonal to all four — a stale translation is still translated, and
    // still published if it was — so making it a fifth LANGUAGE state would
    // have the entry-list dots and the language panel stop reporting a live
    // translation as live.
    //
    // Pinned as a set difference rather than a count: a count stays green if
    // one language state silently disappears while another extra tab arrives.
    const extras = WORKLIST_STATES.map(s => s.value).filter(
      v => !(LANGUAGE_STATES as readonly string[]).includes(v)
    );
    expect(extras).toEqual(["stale"]);
  });

  it("uses the language panel's own wording for every tab that IS a state", () => {
    // A worklist with a vocabulary of its own would describe the same document
    // differently depending on which screen asked. The stale tab is excluded
    // because it has no entry there BY DESIGN -- see the test above -- and
    // demanding one would force the fifth state into the catalog through the
    // back door.
    for (const { value, label } of WORKLIST_STATES) {
      if (!(LANGUAGE_STATES as readonly string[]).includes(value)) continue;
      expect(label.toLowerCase()).toBe(
        LANGUAGE_STATE_LABEL[value as LanguageState]
      );
    }
  });

  it("labels the stale tab by what to DO, not by what was measured", () => {
    const stale = WORKLIST_STATES.find(s => s.value === "stale");
    // "Needs review" rather than "Stale" or "Outdated": a translation whose
    // source moved may still be perfectly correct, so the instruction is to
    // look at it, not to assume it is wrong.
    expect(stale?.label).toBe("Needs review");
  });

  it("leads with the question this page exists to answer", () => {
    // The one thing that IS this page's own: the language panel reads
    // best-to-worst, a worklist reads worst-first.
    expect(WORKLIST_STATES[0]?.value).toBe("missing");
  });
});
