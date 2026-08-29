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
  type WorklistState,
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

  it("offers exactly ONE tab that is not a language state", () => {
    // 🔴 The capability check landed, so "Needs review" is offered — and the vocabulary decision
    // this guards did not change with it. `stale` is a FILTER, not a fifth `LanguageState`:
    // staleness is orthogonal to all four, and a stale translation is still published if it was
    // published. A fifth catalog member would make the classifier return "needs review" INSTEAD
    // of "published" and take a live translation off every screen that renders a dot.
    //
    // Asserted as a set difference rather than a count: a count stays green if a language state
    // silently disappears while an extra tab arrives.
    const extras = WORKLIST_STATES.map(s => s.value).filter(
      v => !(LANGUAGE_STATES as readonly string[]).includes(v)
    );
    expect(extras).toEqual(["stale"]);
    // And it is still absent from the catalog, which is where the orthogonality actually lives.
    expect(LANGUAGE_STATES as readonly string[]).not.toContain("stale");
  });

  it("uses the language panel's own wording for every tab that IS a state", () => {
    // A worklist with a vocabulary of its own would describe the same document differently
    // depending on which screen asked. The review tab is skipped because it has no entry in the
    // language-state catalog BY DESIGN -- see the test above -- and demanding one would force the
    // fifth state into the catalog through the back door.
    for (const { value, label } of WORKLIST_STATES) {
      if (!(LANGUAGE_STATES as readonly string[]).includes(value)) continue;
      expect(label.toLowerCase()).toBe(
        LANGUAGE_STATE_LABEL[value as LanguageState]
      );
    }
  });

  it("routes a saved link naming `stale` to the review tab", () => {
    // 🔴 The other half of the inversion. A URL is resolved against the TAB LIST, so while the tab
    // was withheld a saved link fell back to the page's leading question — deliberately, because a
    // page filtered by a state whose tab is not shown highlights nothing while listing a subset
    // the reader cannot account for. Now the tab exists, the link resolves to it, and the two are
    // consistent again for the same reason they were consistent before.
    const resolved: WorklistState = "stale";
    expect(resolved).toBe("stale");
    expect(worklistStateFrom("stale")).toBe("stale");
    // Unchanged and still the control: anything the tab list does not offer still falls back
    // rather than reaching the server as an unknown state.
    expect(worklistStateFrom("not-a-state")).toBe("missing");
    expect(worklistStateFrom(undefined)).toBe("missing");
  });

  it("leads with the question this page exists to answer", () => {
    // The one thing that IS this page's own: the language panel reads
    // best-to-worst, a worklist reads worst-first.
    expect(WORKLIST_STATES[0]?.value).toBe("missing");
  });
});
