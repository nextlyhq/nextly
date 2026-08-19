import { describe, expect, it } from "vitest";

import { workingDraftLocale } from "../working-draft-locale";

describe("workingDraftLocale", () => {
  it("is null for an unlocalized document, whatever locale was requested", () => {
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

  it("is null for a localized document with no locale resolvable", () => {
    // Rather than inventing one: a draft stored under a guessed locale is
    // stranded, because no later read would look under that key.
    expect(workingDraftLocale({ documentLocalized: true })).toBeNull();
  });
});
