// @vitest-environment jsdom

/**
 * The mark drawn beside a block's name.
 *
 * Two things are worth holding here and neither is about a particular glyph:
 * that every concept the engine offers can actually be drawn, and that a name
 * this editor has never seen degrades to a mark rather than taking the panel
 * down with it.
 *
 * @module block-icon.test
 */
import { BLOCK_ICONS } from "@nextlyhq/blocks-engine";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BlockIconMark, DRAWN_ICONS } from "./block-icon";

/*
 * Nothing unmounts a render on its own here: this package configures no setup
 * file, so `@testing-library/react` never registers its automatic cleanup. Left
 * out, every render accumulates in one document and a `document.querySelector`
 * returns the FIRST test's element for every test after it — each case then
 * asserts about a mark some earlier case drew, and a table resolving no concept
 * at all passes throughout.
 */
afterEach(cleanup);

describe("a block's mark", () => {
  it("reads a populated vocabulary", () => {
    // The population before the property. The coverage assertion below is a
    // loop over this list, and an empty one satisfies it by having nothing to
    // contradict — a vocabulary that stopped being exported would read as
    // complete coverage.
    expect(BLOCK_ICONS.length).toBeGreaterThan(20);
    expect(BLOCK_ICONS as readonly string[]).toContain("columns");
    expect(DRAWN_ICONS.length).toBeGreaterThan(20);
  });

  it("blockIconsCoverTheVocabulary: draws every concept the engine offers", () => {
    /*
     * What holds the drawing table to the engine's list. A concept added there
     * and not drawn here would fall back to the generic mark on every block
     * that named it — a palette that looks finished and is not, with nothing
     * anywhere reporting the gap.
     */
    const drawn = new Set(DRAWN_ICONS);
    const missing = BLOCK_ICONS.filter(name => !drawn.has(name));
    expect(missing).toEqual([]);
  });

  it("draws nothing this editor cannot name, in the other direction", () => {
    // The reverse drift: a drawing kept for a concept the engine no longer
    // offers is dead weight nothing can reach, and it is invisible from the
    // assertion above.
    const offered = new Set<string>(BLOCK_ICONS);
    expect(DRAWN_ICONS.filter(name => !offered.has(name))).toEqual([]);
  });

  it.each([...BLOCK_ICONS])("everyConceptDrawsAGlyph: %s", name => {
    /*
     * Per concept rather than per table entry. The coverage test above compares
     * two lists of STRINGS, so it stays green when a name in the table resolves
     * to nothing — and the names come from `lucide-react`, a peer dependency
     * this package admits from `>=0.400.0` upward, which renames icons and
     * drops the old names. An import of a name outside that range fails to link
     * the built shell rather than failing here, so what this can catch is the
     * table naming something the INSTALLED lucide no longer exports.
     *
     * Asserted as "not the fallback" rather than "an svg exists", because the
     * fallback renders an svg too and would satisfy the weaker form for every
     * concept in a table that resolved none of them.
     */
    render(<BlockIconMark icon={name} />);
    const mark = document.querySelector(".nx-block-icon svg");
    expect(mark, name).not.toBeNull();
    expect(mark?.getAttribute("class") ?? "", name).not.toContain(
      "lucide-blocks"
    );
  });

  it("falls back rather than throwing on a name it has never seen", () => {
    // A newer engine, or a plugin author's typo. Neither is worth failing a
    // render over, and this editor cannot tell them apart.
    render(<BlockIconMark icon="a-concept-from-the-future" />);
    expect(document.querySelector(".nx-block-icon")).not.toBeNull();
    expect(document.querySelector(".nx-block-icon svg")).not.toBeNull();
  });

  it("draws the fallback for a block that names no icon at all", () => {
    // Absent is legitimate: the engine says so, and nothing requires a block to
    // answer. A row with no mark would be a different SHAPE from every row
    // beside it, which is what makes a list scannable.
    render(<BlockIconMark />);
    expect(document.querySelector(".nx-block-icon svg")).not.toBeNull();
  });

  it.each(["__proto__", "constructor", "toString", "valueOf"])(
    "survives an icon named %s",
    name => {
      /*
       * The name is a string that reached the panel from a block definition,
       * and the drawing table is an ordinary object that inherits from
       * `Object.prototype`. Looked up without an own-property check,
       * `"constructor"` resolves to a FUNCTION, which is then used as a JSX
       * element type and throws while rendering the palette — every block gone,
       * because one plugin chose an unlucky word.
       *
       * Asserted as a render rather than as a lookup, because the throw happens
       * at element creation and a unit test of the map would not reach it.
       */
      expect(() => render(<BlockIconMark icon={name} />)).not.toThrow();
      expect(document.querySelector(".nx-block-icon svg")).not.toBeNull();
    }
  );

  it("is decorative, so a screen reader is not told the name twice", () => {
    // Every surface draws the block's name as text beside the mark. An icon
    // that announced itself would repeat it, and one announcing as an unnamed
    // image would be worse than silence — the bargain the layers badges already
    // strike.
    render(<BlockIconMark icon="columns" />);
    const mark = document.querySelector(".nx-block-icon");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
