/**
 * Which chip a language of one document gets, from the facts the list read carries on the row.
 * Each state is reached by exactly the facts that should reach it, and the facts a chip's one
 * word leaves out are still in its spoken name.
 */
import { describe, expect, it } from "vitest";

import {
  LANGUAGE_CHIP_MEANING,
  LANGUAGE_CHIP_STATES,
  LANGUAGE_CHIP_WORD,
  languageChipFacts,
  languageChipSpoken,
} from "../language-chips";

describe("languageChipFacts", () => {
  it("calls a language with nothing written missing, whatever else the row says", () => {
    expect(languageChipFacts(undefined).state).toBe("missing");
    // A stale or pending flag on an untranslated language does not make it anything else.
    expect(
      languageChipFacts({
        translated: false,
        status: "published",
        stale: true,
        pendingChange: true,
      })
    ).toEqual({ state: "missing", live: false, pendingChange: false });
  });

  it("calls a published language live, and changes once a saved change waits in it", () => {
    expect(
      languageChipFacts({ translated: true, status: "published" }).state
    ).toBe("live");
    expect(
      languageChipFacts({
        translated: true,
        status: "published",
        pendingChange: true,
      }).state
    ).toBe("changes");
  });

  it("calls a language not yet published draft, even while it holds a change", () => {
    expect(languageChipFacts({ translated: true, status: "draft" }).state).toBe(
      "draft"
    );
    expect(
      languageChipFacts({
        translated: true,
        status: "draft",
        pendingChange: true,
      }).state
    ).toBe("draft");
  });

  it("calls a language whose source moved out of date, live or not, and keeps the rest", () => {
    // Out of date wins the one word: readers are shown a translation of older text. The facts
    // the word leaves out stay on the chip.
    expect(
      languageChipFacts({
        translated: true,
        status: "published",
        stale: true,
        pendingChange: true,
      })
    ).toEqual({ state: "outOfDate", live: true, pendingChange: true });
    expect(
      languageChipFacts({ translated: true, status: "draft", stale: true })
    ).toEqual({ state: "outOfDate", live: false, pendingChange: false });
  });

  it("is live only where both the document and the language are public", () => {
    // A collection with the lifecycle but no status per language: every language follows the
    // document's.
    expect(languageChipFacts({ translated: true }, "draft").state).toBe(
      "draft"
    );
    expect(languageChipFacts({ translated: true }, "published").state).toBe(
      "live"
    );
    // Neither stands in for the other: a language published in a document still in draft is
    // not served, so it is not live.
    expect(
      languageChipFacts({ translated: true, status: "published" }, "draft")
    ).toEqual({ state: "draft", live: false, pendingChange: false });
    expect(
      languageChipFacts(
        { translated: true, status: "published", pendingChange: true },
        "draft"
      ).state
    ).toBe("draft");
    // And a draft language in a published document is not live either.
    expect(
      languageChipFacts({ translated: true, status: "draft" }, "published")
        .state
    ).toBe("draft");
    expect(
      languageChipFacts({ translated: true, status: "published" }, "published")
        .state
    ).toBe("live");
  });

  it("calls written content with no lifecycle at all live", () => {
    // Without a status anywhere, a written language is what readers are shown.
    expect(languageChipFacts({ translated: true }).state).toBe("live");
    expect(
      languageChipFacts({ translated: true, pendingChange: true }).state
    ).toBe("changes");
  });
});

describe("languageChipSpoken", () => {
  it("says each state, and what an out-of-date chip's word left out", () => {
    const spoken = (meta: Parameters<typeof languageChipFacts>[0]) =>
      languageChipSpoken(languageChipFacts(meta));
    expect(spoken(undefined)).toBe("missing");
    expect(spoken({ translated: true, status: "draft" })).toBe("draft");
    expect(spoken({ translated: true, status: "published" })).toBe("live");
    expect(
      spoken({ translated: true, status: "published", pendingChange: true })
    ).toBe("live, with unpublished changes");
    expect(
      spoken({
        translated: true,
        status: "published",
        stale: true,
        pendingChange: true,
      })
    ).toBe("out of date, live, with unpublished changes");
    expect(spoken({ translated: true, status: "draft", stale: true })).toBe(
      "out of date, draft"
    );
  });
});

describe("the chip vocabulary", () => {
  it("names and explains every state, in sentence case, and never says locale", () => {
    expect(LANGUAGE_CHIP_STATES).toEqual([
      "live",
      "changes",
      "outOfDate",
      "draft",
      "missing",
    ]);
    for (const state of LANGUAGE_CHIP_STATES) {
      const word = LANGUAGE_CHIP_WORD[state];
      expect(word.charAt(0)).toBe(word.charAt(0).toUpperCase());
      expect(word.slice(1)).toBe(word.slice(1).toLowerCase());
      expect(LANGUAGE_CHIP_MEANING[state]).not.toMatch(/locale/i);
    }
  });
});
