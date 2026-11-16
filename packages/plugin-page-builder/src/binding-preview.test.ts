/**
 * How the binding picker shows a value: its start as text, cut short, the
 * same for the host's listed fields and a list's first entry.
 */
import { describe, expect, it } from "vitest";

import { previewOf, rowPreviews } from "./binding-preview";

describe("a value's preview", () => {
  it("shows text trimmed, a number and a yes-or-no", () => {
    expect(previewOf("  Spring sale ")).toBe("Spring sale");
    expect(previewOf(2026)).toBe("2026");
    expect(previewOf(false)).toBe("false");
  });

  it("cuts long text at 80 characters, ending in an ellipsis", () => {
    const shown = previewOf("a".repeat(120));
    expect(shown).toHaveLength(80);
    expect(shown?.endsWith("…")).toBe(true);
    // Text that fits is never cut.
    expect(previewOf("a".repeat(80))).toBe("a".repeat(80));
  });

  it("shows nothing for empty text, a record, a list or nothing", () => {
    expect(previewOf("   ")).toBeUndefined();
    expect(previewOf({ name: "Ada" })).toBeUndefined();
    expect(previewOf(["a"])).toBeUndefined();
    expect(previewOf(null)).toBeUndefined();
  });
});

describe("an entry's previews by path", () => {
  it("previews its fields and one step into a group or a relation", () => {
    expect(
      rowPreviews({
        title: "Highway 9 realignment",
        year: 2026,
        author: { name: "Ada", team: { name: "Survey" } },
        tags: ["roads"],
        cover: null,
      })
    ).toEqual({
      title: "Highway 9 realignment",
      year: "2026",
      "author.name": "Ada",
    });
  });
});
