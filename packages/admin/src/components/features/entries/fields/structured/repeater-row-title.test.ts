/**
 * A repeater row's title, in the order the row header and the Page Builder's
 * location both read it: each source wins over the ones after it, and the
 * position is used only when the row holds no title of its own.
 */
import { describe, expect, it } from "vitest";

import { repeaterRowTitle } from "./repeater-row-title";

const sections = {
  labels: { singular: "Section" },
  fields: [
    { name: "kicker", type: "text" },
    { name: "caption", type: "text", admin: { useAsTitle: true } },
  ],
};

describe("repeaterRowTitle", () => {
  it("reads the field the repeater names as its row label first", () => {
    expect(
      repeaterRowTitle(
        { ...sections, rowLabelField: "kicker" },
        { kicker: "Hero banner", heading: "Ignored", caption: "Ignored" },
        1
      )
    ).toEqual({ title: "Hero banner", fromContent: true });
  });

  it("then a conventional title field, before a marked one", () => {
    expect(
      repeaterRowTitle(sections, { heading: "Pricing", caption: "Ignored" }, 1)
    ).toEqual({ title: "Pricing", fromContent: true });
  });

  it("then a sub-field marked useAsTitle", () => {
    expect(repeaterRowTitle(sections, { caption: "Closing" }, 1)).toEqual({
      title: "Closing",
      fromContent: true,
    });
  });

  it("ignores a marker that is not an object, or on a field without a name", () => {
    const odd = {
      fields: [
        { name: "caption", admin: "useAsTitle" },
        { admin: { useAsTitle: true } },
      ],
    };
    expect(repeaterRowTitle(odd, { caption: "Not a title" }, 0)).toEqual({
      title: "Item 1",
      fromContent: false,
    });
  });

  it("falls back to the singular label and position, and says it did", () => {
    // The one title that changes when the rows are reordered.
    expect(repeaterRowTitle(sections, { heading: "" }, 2)).toEqual({
      title: "Section 3",
      fromContent: false,
    });
  });
});
