/**
 * The parts a write's status moves change, as its history records them
 * (`partsMovesRecord`): the version a publish records reads this, from the
 * same moves its history event is handed, so the two name the same parts.
 *
 * A move between equal states records nothing, so it names no part: a
 * language already published that a publish of every language leaves as it
 * was is not one the publish changed.
 */
import { describe, expect, it } from "vitest";

import { partsMovesRecord } from "../write-event";

describe("partsMovesRecord", () => {
  it("names each language that moved, and the shared part for the document's own move", () => {
    expect(
      partsMovesRecord([
        { from: "draft", to: "published" },
        { locale: "es", from: "draft", to: "published" },
        { locale: "en", from: null, to: "published" },
      ])
    ).toEqual({ locales: ["es", "en"], shared: true });
  });

  it("names no part for a move between equal states", () => {
    expect(
      partsMovesRecord([
        { from: "published", to: "published" },
        { locale: "en", from: "published", to: "published" },
        { locale: "es", from: "draft", to: "published" },
      ])
    ).toEqual({ locales: ["es"], shared: false });
  });

  it("names the parts an unpublish took down", () => {
    expect(
      partsMovesRecord([{ locale: "es", from: "published", to: "draft" }])
    ).toEqual({ locales: ["es"], shared: false });
  });
});
