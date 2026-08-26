import { describe, expect, it } from "vitest";

import {
  INLINE_STYLE_PROPERTIES,
  isInlineStyleProperty,
  readInlineStyle,
  RICH_TEXT_FONT_FAMILIES,
  RICH_TEXT_FONT_SIZES,
  sanitizeInlineStyle,
} from "./inline-style";

const read = (value: string): Record<string, string> =>
  Object.fromEntries(readInlineStyle(value));

describe("readInlineStyle", () => {
  it("reads the four properties the editor writes", () => {
    // The population, and it is the whole point of the task: these are what
    // `$patchStyleText` puts on a text node, and the renderer drew none of them.
    expect(
      read(
        "font-family: Georgia; font-size: 24px; color: #ff0000; background-color: #00ff00"
      )
    ).toEqual({
      "font-family": "Georgia",
      "font-size": "24px",
      color: "#ff0000",
      "background-color": "#00ff00",
    });
  });

  it.each(RICH_TEXT_FONT_FAMILIES)("keeps the family %s", family => {
    // Every value the editor can PRODUCE must survive the reader. This is the
    // direction that matters: a reader stricter than its own editor drops a
    // choice the author made and shows them nothing to explain it.
    expect(read(`font-family: ${family}`)["font-family"]).toBe(family);
  });

  it.each(RICH_TEXT_FONT_SIZES)("keeps the size %s", size => {
    expect(read(`font-size: ${size}`)["font-size"]).toBe(size);
  });

  it("keeps a colour from the editor's own colour input", () => {
    // `<input type="color">` can only produce `#rrggbb`, so this is the entire
    // colour vocabulary an author can reach through the toolbar.
    expect(read("color: #3b82f6")["color"]).toBe("#3b82f6");
  });

  it.each([
    ["a declaration break", "color: red;position:fixed", { color: "red" }],
    ["a url()", "background-color: url(https://example.test/x)", {}],
    ["an IE expression", "color: expression(alert(1))", {}],
    ["a custom property", "color: var(--stolen)", {}],
    ["a CSS escape", "color: \\65 xpression(alert(1))", {}],
    ["a comment", "color: red/*x*/", {}],
  ])("refuses %s", (_label, value, expected) => {
    expect(read(value)).toEqual(expected);
  });

  it.each([
    ["position", "position: fixed"],
    ["display", "display: none"],
    ["z-index", "z-index: 9999"],
    ["float", "float: left"],
    ["width", "width: 200vw"],
  ])("drops %s, which is not typography", (_label, value) => {
    // The properties that let stored text escape the box the page gave it. They
    // are refused by ABSENCE from the list rather than by a rule naming them,
    // which is why the list is the thing to read.
    expect(read(value)).toEqual({});
  });

  it("keeps the LAST declaration when a property is written twice", () => {
    // A stylesheet resolves a repeated property to the last one, and a reader
    // that kept the first would publish something the CMS's own HTML does not.
    expect(read("color: red; color: blue")["color"]).toBe("blue");
  });

  it("reads a property name however the document spells it", () => {
    // Stored text, so the casing and the spacing are whatever wrote it.
    expect(read("  Font-Size : 16px  ")["font-size"]).toBe("16px");
  });

  it("drops one bad declaration without losing the rest", () => {
    // A stored style is not a request — it is what an old document happens to
    // contain — so one unreadable declaration must not take the author's colour
    // with it.
    expect(read("color: #fff; position: fixed; font-size: 16px")).toEqual({
      color: "#fff",
      "font-size": "16px",
    });
  });

  it("returns nothing for a value that is not a style string", () => {
    for (const value of [undefined, null, 16, {}, [], ""]) {
      expect(readInlineStyle(value).size).toBe(0);
    }
  });
});

describe("sanitizeInlineStyle", () => {
  it("emits exactly what the reader kept", () => {
    /*
     * DERIVED, not parsed a second time. The two agree here by construction,
     * and this asserts that they still do: if the serializer ever grew its own
     * pass, a value one accepted and the other refused would publish HTML that
     * disagreed with the React page for the same stored node — which is the
     * defect this whole module exists to make impossible.
     */
    const value =
      "font-size: 16px; position: fixed; color: #fff; behavior: url(x.htc)";
    const kept = [...readInlineStyle(value)]
      .map(([property, declared]) => `${property}:${declared}`)
      .join(";");
    expect(sanitizeInlineStyle(value)).toBe(kept);
    expect(sanitizeInlineStyle(value)).toBe("font-size:16px;color:#fff");
  });

  it("emits nothing when nothing survives", () => {
    expect(sanitizeInlineStyle("position: fixed")).toBe("");
  });
});

describe("INLINE_STYLE_PROPERTIES", () => {
  it("is readable as data, because a differ cannot use a sanitizer", () => {
    // The versions differ asks "would a reader notice this property changing",
    // which a function returning a cleaned string cannot answer. Exported as a
    // list so it can be read rather than re-derived from someone's output.
    expect(INLINE_STYLE_PROPERTIES.length).toBeGreaterThan(1);
    expect([...INLINE_STYLE_PROPERTIES]).toContain("color");
    expect([...INLINE_STYLE_PROPERTIES]).not.toContain("position");
  });

  it("agrees with the reader, so neither can drift", () => {
    // Both directions. A property on the list the reader drops is a promise the
    // data does not keep; one the reader keeps that is absent from the list is
    // a declaration the differ cannot see.
    for (const property of INLINE_STYLE_PROPERTIES) {
      expect(isInlineStyleProperty(property), property).toBe(true);
      expect(read(`${property}: inherit`)[property], property).toBe("inherit");
    }
  });

  it("answers for a name however it is spelled, and refuses a non-string", () => {
    expect(isInlineStyleProperty("  Color ")).toBe(true);
    expect(isInlineStyleProperty("position")).toBe(false);
    expect(isInlineStyleProperty(undefined)).toBe(false);
  });
});
