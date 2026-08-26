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

describe("a repeated property whose later value is unusable", () => {
  it("keeps the fallback a browser would keep", () => {
    /*
     * `color: red; color: not-a-color` renders RED. The second declaration is
     * discarded when it is parsed, so the first is what applies — which is the
     * whole point of writing a fallback chain, and what the CMS used to get
     * right by emitting both declarations.
     *
     * Deduplicating on POSITION alone loses it. Judging the VALUE recovers it.
     */
    expect(read("color: red; color: not-a-color")["color"]).toBe("red");
    /*
     * `banana` and not only `not-a-color`, because the two are refused by
     * DIFFERENT things and only one of them was ever the point. `not-a-color` is
     * hyphenated, so it failed the old alphabetic pattern by accident of its
     * spelling — the test passed while an unknown NAME still deleted its
     * fallback. This is the value that separates the two implementations.
     */
    expect(read("color: red; color: banana")["color"]).toBe("red");
  });

  it("still lets a later VALID colour win", () => {
    // The control, and it is the one that matters: a rule that simply kept the
    // first declaration would satisfy the assertion above and break every
    // ordinary override.
    expect(read("color: red; color: #00ff00")["color"]).toBe("#00ff00");
  });

  it("cannot do the same for a length, and says so", () => {
    /*
     * The limit, asserted rather than left to be discovered. Deciding that
     * `not-a-size` is not a length means a CSS property database, which this
     * package does not have and should not grow for this. So the later
     * declaration wins, which is what a browser does whenever the later one IS
     * valid — the divergence is confined to the case where it is not.
     */
    expect(read("font-size: 16px; font-size: not-a-size")["font-size"]).toBe(
      "not-a-size"
    );
  });
});

describe("a declaration carrying !important", () => {
  it("keeps the declaration and drops the priority", () => {
    /*
     * React sets a style property through `CSSStyleDeclaration`, which REJECTS
     * a value with an embedded priority and leaves the property unset — while
     * server rendering writes the string out and it applies. Carried through,
     * the same document would render one way from the server and another once
     * the client mounted.
     *
     * Stripping costs only the priority, which an inline style barely needs: it
     * already outranks every stylesheet rule that is not itself `!important`.
     */
    expect(read("color: red!important")["color"]).toBe("red");
    expect(read("color: red ! important ")["color"]).toBe("red");
  });

  it("lets an important declaration beat a later plain one", () => {
    /*
     * `color: red !important; color: blue` renders RED. The cascade prefers the
     * important declaration whatever follows it, so resolving the repeat on
     * POSITION alone published blue — the browser's answer and ours disagreeing
     * on a document neither of us wrote.
     *
     * The priority has to be read BEFORE it is stripped, which is the whole
     * shape of the bug: stripping first made the two declarations look alike.
     */
    expect(read("color: red !important; color: blue")["color"]).toBe("red");
  });

  it("still lets a later important declaration win", () => {
    // Two controls in one: priority does not simply freeze the first value, and
    // between two important declarations position decides again.
    expect(read("color: red; color: blue !important")["color"]).toBe("blue");
    expect(read("color: red !important; color: blue !important")["color"]).toBe(
      "blue"
    );
  });

  it("gives the same answer however many times it is asked", () => {
    // The priority pattern is shared across calls. It carries no `g`, so it
    // holds no `lastIndex` — but a global flag on a shared regex has already
    // produced a call-order-dependent guard in this package once, and the cost
    // of asserting it is three lines.
    const value = "color: red !important; color: blue";
    expect(read(value)["color"]).toBe("red");
    expect(read(value)["color"]).toBe("red");
    expect(read("color: blue")["color"]).toBe("blue");
    expect(read(value)["color"]).toBe("red");
  });

  it("does not take the rest of the declaration list with it", () => {
    expect(read("color: red !important; font-size: 16px")).toEqual({
      color: "red",
      "font-size": "16px",
    });
  });

  it("leaves an inner `!important` alone rather than editing the value", () => {
    // Anchored at the END. A value that merely CONTAINS the word is not a
    // priority, and rewriting the middle of a declaration would be this
    // function inventing CSS rather than removing a suffix.
    expect(read('font-family: "not!important"')["font-family"]).toBe(
      '"not!important"'
    );
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

  it.each([
    ["BOLD", TEXT_FORMAT.BOLD, "font-weight: 900", "font-weight", "900"],
    ["BOLD", TEXT_FORMAT.BOLD, "font-weight: bolder", "font-weight", "bolder"],
    [
      "ITALIC",
      TEXT_FORMAT.ITALIC,
      "font-style: oblique 10deg",
      "font-style",
      "oblique 10deg",
    ],
    [
      "UNDERLINE",
      TEXT_FORMAT.UNDERLINE,
      "text-decoration: underline wavy red",
      "text-decoration",
      "underline wavy red",
    ],
  ])(
    "keeps a value that REINFORCES %s",
    (_l, flag, style, property, expected) => {
      /*
       * The first version of this rule dropped the property outright whenever
       * the bit was set, which threw away declarations that agree with it and
       * carry more than the element alone: a weight of 900 where `<strong>` gives
       * 700, a wavy red underline where `<u>` gives a plain one.
       *
       * The no-bit control could not catch that — it asserts what happens with
       * no format at all, and passes under a rule that drops everything when a
       * format IS set. Reinforcement is its own case and needs its own test.
       */
      expect(read(style, flag)[property]).toBe(expected);
    }
  );

  it("keeps a decoration that adds a line the bit does not draw", () => {
    /*
     * This asserted the opposite and was wrong, so the correction is worth
     * stating: a decoration on a descendant ACCUMULATES with an ancestor's
     * rather than replacing it, and a descendant cannot remove one. So
     * `underline` beside a STRIKETHROUGH bit does not take the strike away —
     * the `<s>` still draws it — and dropping the declaration threw away an
     * underline the author wrote.
     *
     * The shorthand replaces the line list WITHIN its own element. It does not
     * reach the wrapper's.
     */
    expect(
      read("text-decoration: underline wavy red", TEXT_FORMAT.STRIKETHROUGH)[
        "text-decoration"
      ]
    ).toBe("underline wavy red");
    expect(
      read("text-decoration: line-through", TEXT_FORMAT.UNDERLINE)[
        "text-decoration"
      ]
    ).toBe("line-through");
  });

  it("drops a decoration that draws no line, since it cannot cancel one", () => {
    // `none` is the only decoration value with nothing to say: it cannot remove
    // the wrapper's line and adds none of its own, so publishing it would put
    // an inert declaration on the page.
    expect(
      Object.keys(read("text-decoration: none", TEXT_FORMAT.UNDERLINE))
    ).not.toContain("text-decoration");
  });

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

describe("the declaration list", () => {
  it("does not split on a semicolon inside a quoted value", () => {
    // `font-family: "A;B"` is one declaration carrying a family whose NAME has a
    // semicolon in it. Split on every `;`, it came apart in the middle and
    // published `font-family:"A` — a truncated value, and the authored font
    // gone. Escapes need no handling here: a backslash is refused outright.
    expect(read('font-family: "A;B"; color: red')).toEqual({
      "font-family": '"A;B"',
      color: "red",
    });
  });

  it("does not split on a semicolon inside parentheses", () => {
    // Nothing in CSS puts one there today. The cost of covering it is a
    // counter; the cost of being wrong is a value truncated in silence.
    expect(read('font-family: local("A;B"); color: red')["color"]).toBe("red");
  });

  it("still splits the ordinary case", () => {
    // The control. A splitter that never split would satisfy neither assertion
    // above by accident, but one that got its quote state stuck would.
    expect(Object.keys(read("color: red; font-size: 16px"))).toEqual([
      "color",
      "font-size",
    ]);
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
