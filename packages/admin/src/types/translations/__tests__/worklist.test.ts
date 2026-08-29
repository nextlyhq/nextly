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

  it("offers NO tab the server cannot answer", () => {
    // 🔴 "Needs review" is built and withheld. The server answers that state with
    // "nothing is known to be stale", because nothing can yet establish whether
    // a companion physically carries the timestamp the answer depends on — so
    // an always-empty tab would read as "this site has no stale translations",
    // which is a claim, and the wrong one.
    //
    // Asserted as a set difference rather than a count: a count stays green if
    // a language state silently disappears while an extra tab arrives.
    //
    // This test is the one to INVERT when the capability check lands. The
    // vocabulary decision it guards does not change — `stale` is a filter, not
    // a fifth `LanguageState`, because staleness is orthogonal to all four and
    // a stale translation is still published if it was published.
    const extras = WORKLIST_STATES.map(s => s.value).filter(
      v => !(LANGUAGE_STATES as readonly string[]).includes(v)
    );
    expect(extras).toEqual([]);
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

  it("keeps `stale` askable while refusing to route a URL to it", () => {
    // Two different facts, and the pairing is the point. `WorklistState` is
    // what goes on the wire, so it carries every state the server accepts --
    // `stale` included, which is why a caller holding one can name it.
    const resolved: WorklistState = "stale";
    expect(resolved).toBe("stale");
    // But a URL is resolved against the TAB LIST, not against the wire
    // vocabulary, so a saved link naming `stale` does NOT reach the server as
    // `stale`: it falls back to the question this page leads with. A page
    // filtered by a state whose tab is not shown would highlight nothing while
    // listing a subset the reader cannot account for.
    expect(worklistStateFrom("stale")).toBe("missing");
  });

  it("leads with the question this page exists to answer", () => {
    // The one thing that IS this page's own: the language panel reads
    // best-to-worst, a worklist reads worst-first.
    expect(WORKLIST_STATES[0]?.value).toBe("missing");
  });
});
