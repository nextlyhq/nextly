/**
 * Every language's publish state of the documents a publish reads at once. A per-language table
 * keeps no `_status` where its entity publishes as a document, as an untranslated entity under
 * `experimental.perLanguageStorage` does, so there is no state per language to read there: the
 * read answers none rather than selecting a column the table does not have.
 */
import { describe, expect, it, vi } from "vitest";

import { readCompanionLocaleStatusAllOf } from "../companion-join";

describe("readCompanionLocaleStatusAllOf", () => {
  it("answers no state, and reads nothing, from a per-language table without `_status`", async () => {
    const select = vi.fn();
    const companion = { _parent: {}, _locale: {} };

    const states = await readCompanionLocaleStatusAllOf(
      { select } as never,
      companion,
      ["e1"],
      "ready"
    );

    expect(states.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});
