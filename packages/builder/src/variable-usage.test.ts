/**
 * The rules behind what the Variables tab says about usage: the count at the
 * end of a row, the editor's status line, whether Remove may go ahead, and
 * what a shared style using a variable sets with it.
 *
 * `tokens-panel.usage.test` drives the same rules through the panel.
 *
 * @module variable-usage.test
 */
import {
  BASE_BREAKPOINT,
  type NamedClass,
  type StyleValues,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { VARIABLE_LOSS_WORDS } from "./editor-words";
import {
  sharedStyleSets,
  variableCount,
  variableLossSentence,
  variableRemoval,
  variableStatus,
  type VariableReach,
} from "./variable-usage";

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

/** A reach of `documents` pages, these shared styles and these block defaults. */
function reach(
  documents: number,
  sharedStyles: readonly string[] = [],
  complete = true,
  blockDefaults: readonly string[] = []
): VariableReach {
  return {
    documents,
    byKind: { ...NONE, pages: documents },
    sharedStyles,
    blockDefaults,
    complete,
  };
}

describe("the count at the end of a row", () => {
  it("is the places: the documents and the shared styles together", () => {
    // 12 documents and 2 shared styles: a count of either alone is wrong.
    expect(variableCount(reach(12, ["c-card", "c-hero"]))).toEqual({
      text: "14",
      words: "Used in 14 places",
      zero: false,
      floor: false,
    });
  });

  it("counts the block types whose default styles name it as places too", () => {
    // 2 documents, 1 shared style and 2 block types: 5 places.
    expect(
      variableCount(reach(2, ["c-card"], true, ["core/button", "core/heading"]))
        .words
    ).toBe("Used in 5 places");
    expect(variableCount(reach(0, [], true, ["core/button"])).text).toBe("1");
  });

  it("says one place in the singular", () => {
    expect(variableCount(reach(0, ["c-card"])).words).toBe("Used in 1 place");
    expect(variableCount(reach(1)).words).toBe("Used in 1 place");
  });

  it("is a muted zero when nothing uses it", () => {
    expect(variableCount(reach(0))).toEqual({
      text: "0",
      words: "Not used anywhere",
      zero: true,
      floor: false,
    });
  });

  it("is a floor, 2+, while some pages are not counted yet", () => {
    expect(variableCount(reach(1, ["c-card"], false))).toEqual({
      text: "2+",
      words: "Used in at least 2 places. Some pages aren't counted yet.",
      zero: false,
      floor: true,
    });
  });

  it("says a zero that is a floor in words, as a shared style's row does", () => {
    const count = variableCount(reach(0, [], false));
    expect(count.text).toBe("Not counted yet");
    expect(count.words).toBe(
      "No uses counted yet. Some pages aren't counted yet."
    );
    expect(count.zero).toBe(true);
  });
});

describe("what Remove may do", () => {
  it("goes ahead behind the confirm only when nothing uses it, counted whole", () => {
    expect(variableRemoval(reach(0))).toBe("free");
  });

  it("refuses while anything uses it, a shared style alone included", () => {
    expect(variableRemoval(reach(3))).toBe("in-use");
    expect(variableRemoval(reach(0, ["c-card"]))).toBe("in-use");
    // A block type's default style alone is a use as well.
    expect(variableRemoval(reach(0, [], true, ["core/button"]))).toBe("in-use");
    // A floor above zero is a use, whatever the rest of the count says.
    expect(variableRemoval(reach(1, [], false))).toBe("in-use");
  });

  it("waits while a zero is not counted whole", () => {
    expect(variableRemoval(reach(0, [], false))).toBe("not-whole");
  });

  it("is unread before the usage is read", () => {
    expect(variableRemoval(undefined)).toBe("unread");
  });
});

describe("the editor's status line", () => {
  it("says how widely it is used, at least while that is a floor", () => {
    expect(variableStatus(reach(14))).toBe("Used in 14 places");
    expect(variableStatus(reach(0, ["c-card"]))).toBe("Used in 1 place");
    expect(variableStatus(reach(1, [], true, ["core/button"]))).toBe(
      "Used in 2 places"
    );
    expect(variableStatus(reach(2, [], false))).toBe(
      "Used in at least 2 places"
    );
  });

  it("says it is unused, or that the uses are still being counted", () => {
    expect(variableStatus(reach(0))).toBe("Not used anywhere");
    expect(variableStatus(reach(0, [], false))).toBe(
      "Counting where it's used…"
    );
  });

  it("says nothing before the usage is read", () => {
    expect(variableStatus(undefined)).toBe("");
  });
});

describe("what the places would lose", () => {
  it("names the loss by the variable's kind", () => {
    expect(variableLossSentence(reach(14), VARIABLE_LOSS_WORDS.color)).toBe(
      "It's used in 14 places, and they would lose this colour:"
    );
    expect(variableLossSentence(reach(1), VARIABLE_LOSS_WORDS.dimension)).toBe(
      "It's used in 1 place, and they would lose this size:"
    );
    expect(
      variableLossSentence(reach(2, [], false), VARIABLE_LOSS_WORDS.fontFamily)
    ).toBe("It's used in at least 2 places, and they would lose this font:");
  });

  it("has a word for every kind", () => {
    expect(VARIABLE_LOSS_WORDS).toEqual({
      color: "colour",
      dimension: "size",
      fontFamily: "font",
      fontWeight: "font weight",
      number: "value",
      shadow: "shadow",
      duration: "value",
      custom: "value",
      lineHeight: "line height",
    });
  });
});

describe("what a shared style sets with a variable", () => {
  const CARD: NamedClass = {
    id: "c-card",
    slug: "card",
    orderIndex: 0,
    styles: {
      base: {
        [BASE_BREAKPOINT]: {
          color: { $token: "color.brand" },
          // Another variable in the same style says nothing of this one.
          backgroundColor: { $token: "color.surface" },
        },
      },
      // Under another state, inside a structured value.
      hover: {
        [BASE_BREAKPOINT]: { padding: { blockStart: { $token: "space.4" } } },
      },
    },
  };

  it("names the property that names the variable, in plain words", () => {
    expect(sharedStyleSets([CARD], "c-card", "color.brand")).toBe(
      "sets text colour"
    );
    expect(sharedStyleSets([CARD], "c-card", "color.surface")).toBe(
      "sets background colour"
    );
  });

  it("finds a look by its id and block type, apart from another type's look of that id", () => {
    const look = (blockType: string, property: string): NamedClass => ({
      id: "look-default",
      slug: "default",
      orderIndex: 0,
      blockType,
      styles: {
        base: { [BASE_BREAKPOINT]: { [property]: { $token: "color.brand" } } },
      },
    });
    const looks = [
      look("core/heading", "color"),
      look("core/button", "backgroundColor"),
    ];
    expect(
      sharedStyleSets(looks, "look-default", "color.brand", "core/button")
    ).toBe("sets background colour");
    expect(
      sharedStyleSets(looks, "look-default", "color.brand", "core/heading")
    ).toBe("sets text colour");
  });

  it("reads every state and a structured value's parts", () => {
    expect(sharedStyleSets([CARD], "c-card", "space.4")).toBe("sets padding");
  });

  it("lists each property once, joined in words", () => {
    const both: NamedClass = {
      ...CARD,
      id: "c-both",
      styles: {
        base: {
          [BASE_BREAKPOINT]: {
            color: { $token: "color.brand" },
            backgroundColor: { $token: "color.brand" },
          },
        },
        hover: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } },
      },
    };
    expect(sharedStyleSets([both], "c-both", "color.brand")).toBe(
      "sets text colour and background colour"
    );
  });

  it("says it uses it where the style is not in hand or the property has no plainer word", () => {
    expect(sharedStyleSets(undefined, "c-card", "color.brand")).toBe("uses it");
    expect(sharedStyleSets([CARD], "c-gone", "color.brand")).toBe("uses it");
    const filtered: NamedClass = {
      ...CARD,
      id: "c-filter",
      styles: { base: { [BASE_BREAKPOINT]: { filter: { $token: "x.blur" } } } },
    };
    expect(sharedStyleSets([filtered], "c-filter", "x.blur")).toBe("uses it");
  });

  it("reads a stored property key as data, not as the words table's prototype", () => {
    const odd: NamedClass = {
      ...CARD,
      id: "c-odd",
      styles: {
        base: {
          [BASE_BREAKPOINT]: JSON.parse(
            '{"__proto__":{"$token":"color.brand"}}'
          ) as StyleValues,
        },
      },
    };
    expect(sharedStyleSets([odd], "c-odd", "color.brand")).toBe("uses it");
  });
});
