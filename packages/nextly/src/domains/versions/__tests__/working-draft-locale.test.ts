import { afterEach, describe, expect, it } from "vitest";

import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../i18n/per-language-storage";
import { workingDraftLocale } from "../working-draft-locale";

// A case that stands in for an earlier release's layout leaves the one every installation runs.
afterEach(() => _resetPerLanguageStorage());

describe("workingDraftLocale", () => {
  it("is null for an unlocalized document, whatever locale was requested (an earlier release's layout)", () => {
    setPerLanguageStorage(false);
    // The key has to be stable across requests: a later read or publish
    // arriving under a different locale must find the same draft.
    expect(
      workingDraftLocale({ documentLocalized: false, requestLocale: "es" })
    ).toBeNull();
    expect(workingDraftLocale({ documentLocalized: false })).toBeNull();
  });

  it("is the requested locale for a localized document", () => {
    expect(
      workingDraftLocale({ documentLocalized: true, requestLocale: "es" })
    ).toBe("es");
  });

  it("falls back to the default locale when none was requested", () => {
    expect(
      workingDraftLocale({ documentLocalized: true, defaultLocale: "en" })
    ).toBe("en");
  });

  it("prefers the requested locale over the default", () => {
    expect(
      workingDraftLocale({
        documentLocalized: true,
        requestLocale: "fr",
        defaultLocale: "en",
      })
    ).toBe("fr");
  });

  it("takes an empty requested locale as none, so the default keys the draft", () => {
    // Kept as itself, an empty locale would key a language's draft as the
    // shared draft's slot, and a save writing both would collide.
    expect(
      workingDraftLocale({
        documentLocalized: true,
        requestLocale: "",
        defaultLocale: "en",
      })
    ).toBe("en");
    expect(
      workingDraftLocale({ documentLocalized: true, requestLocale: "" })
    ).toBeNull();
  });

  it("is null for a localized document with no locale resolvable", () => {
    // Rather than inventing one: a draft stored under a guessed locale is
    // stranded, because no later read would look under that key.
    expect(workingDraftLocale({ documentLocalized: true })).toBeNull();
  });
});
