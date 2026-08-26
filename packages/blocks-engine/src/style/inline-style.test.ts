import { describe, expect, it } from "vitest";

import { TEXT_FORMAT } from "../rich-text";

import {
  INLINE_STYLE_PROPERTIES,
  isInlineStyleProperty,
  readInlineStyle,
  sanitizeInlineStyle,
} from "./inline-style";

const read = (value: string, format?: number): Record<string, string> =>
  Object.fromEntries(readInlineStyle(value, format));

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

  it.each(["Courier New", "Times New Roman", "Georgia"])(
    "keeps the family %s",
    family => {
      /*
       * The SHAPE a real family has, not an enumeration of the toolbar's list.
       * Restating that list here bought nothing — the reader accepts any safe
       * family, so every member passed trivially — while making a new toolbar
       * option fail CI in a package that renders it correctly. What is worth
       * asserting is the property those values share and a bare keyword does
       * not: a space in the middle.
       */
      expect(read(`font-family: ${family}`)["font-family"]).toBe(family);
    }
  );

  it.each(["10px", "24px", "72px"])("keeps the size %s", size => {
    // A unit, for the same reason: `inherit` is legal for every property here
    // and would pass on a reader that dropped anything measured.
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

  it("drops text-align, which a span cannot honour", () => {
    // Both surfaces put a text node's style on a `<span>` — this package's
    // renderer and the CMS's `serializeTextNode` — and `text-align` applies to
    // a block container. Kept on the list it survived sanitization and aligned
    // nothing, so the list promised what no reader could deliver and the
    // versions differ reported an edit no visitor could see.
    expect(read("text-align: center")).toEqual({});
    expect([...INLINE_STYLE_PROPERTIES]).not.toContain("text-align");
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

  it("keeps the winning declaration in its own place in the cascade", () => {
    /*
     * The VALUE test above is not enough, and this is the case that separates
     * them. `Map.set` on an existing key replaces the value and leaves the key
     * where it first appeared, so the later declaration would be emitted in the
     * earlier one's position — ahead of a shorthand that resets it.
     *
     * Here the author's last word is green. Emitted before the shorthand, the
     * shorthand wins and the text draws blue: the right value, in a place that
     * makes it lose.
     */
    expect(
      sanitizeInlineStyle(
        "text-decoration-color:red;text-decoration:underline blue;text-decoration-color:green"
      )
    ).toBe("text-decoration:underline blue;text-decoration-color:green");
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

describe("a format bit and a style that contradict it", () => {
  it.each([
    ["BOLD", TEXT_FORMAT.BOLD, "font-weight: normal", "font-weight"],
    ["ITALIC", TEXT_FORMAT.ITALIC, "font-style: normal", "font-style"],
    [
      "UNDERLINE",
      TEXT_FORMAT.UNDERLINE,
      "text-decoration: none",
      "text-decoration",
    ],
    [
      "STRIKETHROUGH",
      TEXT_FORMAT.STRIKETHROUGH,
      "text-decoration-line: none",
      "text-decoration-line",
    ],
    [
      "SUBSCRIPT",
      TEXT_FORMAT.SUBSCRIPT,
      "vertical-align: baseline",
      "vertical-align",
    ],
  ])(
    "lets %s win over the style that would cancel it",
    (_l, flag, style, property) => {
      /*
       * A paste from a word processor produces exactly this: the bit AND a
       * declaration undoing it. Left to the markup, the answer depends on which
       * is nested deeper — and the two surfaces nest them differently, so the
       * same stored node would render bold on one and not on the other.
       *
       * The bit is an act, a button pressed on this selection. The style string
       * is whatever the document arrived carrying.
       */
      expect(Object.keys(read(style, flag))).not.toContain(property);
    }
  );

  it("drops only what the bit decided", () => {
    // The control. A rule that dropped the whole style when any bit was set
    // would satisfy every assertion above and take the author's colour with it.
    expect(read("font-weight: normal; color: #fff", TEXT_FORMAT.BOLD)).toEqual({
      color: "#fff",
    });
  });

  it("keeps the same declaration when no bit claims it", () => {
    // And the other control: without the bit, `font-weight` is an ordinary
    // choice and must survive. Otherwise the rule is just a narrower allowlist.
    expect(read("font-weight: normal")["font-weight"]).toBe("normal");
  });

  it("leaves font-size to the author under a subscript", () => {
    // `<sub>` shrinks its text as a side effect of being a subscript. The
    // POSITION is what makes it one, so that is what the bit owns; a size the
    // author then chose is a choice, not a contradiction.
    expect(read("font-size: 24px", TEXT_FORMAT.SUBSCRIPT)["font-size"]).toBe(
      "24px"
    );
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
