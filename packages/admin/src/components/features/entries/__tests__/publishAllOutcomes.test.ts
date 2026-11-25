/**
 * What a publish says about each language before it is done, from the server's
 * own outcomes. The plausible broken implementations say pending changes go
 * live for a language whose outcome says otherwise, or name a field its reader
 * may not see.
 */
import { describe, expect, it } from "vitest";

import { outcomeSentence } from "../publishAllOutcomes";

const label = (code: string) =>
  ({ en: "English", de: "German", fr: "French" })[code] ?? code;

describe("what a publish says about each language", () => {
  it("says each outcome as the server reports it", () => {
    expect(
      outcomeSentence(
        { locale: "en", outcome: "goes-live-with-pending-change" },
        label
      )
    ).toBe("Its unpublished changes go live.");
    expect(
      outcomeSentence({ locale: "de", outcome: "stays-published" }, label)
    ).toBe("Stays as published.");
    expect(outcomeSentence({ locale: "fr", outcome: "goes-live" }, label)).toBe(
      "Goes live for the first time."
    );
    expect(
      outcomeSentence(
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
        label
      )
    ).toBe("Goes live with no content of its own, showing English.");
    expect(
      outcomeSentence(
        { locale: "fr", outcome: "shows-fallback", fallback: null },
        label
      )
    ).toBe("Goes live with no content of its own.");
  });

  it("names the out-of-date fields the caller may read and counts the rest", () => {
    expect(
      outcomeSentence(
        {
          locale: "de",
          outcome: "out-of-date",
          fields: ["tagline"],
          hiddenCount: 1,
        },
        label
      )
    ).toBe(
      'Its changes are behind the published tagline and 1 field you can\'t see. Publish German on its own and choose "Take the live values", then publish again.'
    );
  });
});
