/**
 * What a numeric affordance may do to a stored value, and — mostly — what it
 * may not.
 *
 * The leaves come from `STYLE_CATALOG` rather than being written here, because
 * the property under test is that the ENGINE decides. A hand-made leaf asserting
 * `allowNegative: false` would pass against a hardcoded rule in the module just
 * as happily as against the engine being asked, and those are the two
 * implementations that have to be told apart.
 */
import { STYLE_CATALOG, type StyleLeaf } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  CSS_NUMBER,
  measurementOf,
  steppedValue,
  toggleOptionsFor,
  toggleShows,
  unitChoicesFor,
  withUnit,
} from "./style-numeric";

/** One catalog entry, as the array actually stores them. */
interface CatalogEntry {
  readonly property: string;
  readonly shape: Record<string, unknown>;
}

const entry = (property: string): CatalogEntry => {
  const found = (STYLE_CATALOG as unknown as readonly CatalogEntry[]).find(
    candidate => candidate.property === property
  );
  if (found === undefined) throw new Error(`no catalog entry for ${property}`);
  return found;
};

/** The leaf on one logical side of a box property. */
const side = (property: string): StyleLeaf => {
  const sides = entry(property).shape.sides as Record<string, StyleLeaf>;
  const leaf = sides.blockStart;
  if (leaf === undefined) throw new Error(`${property} has no blockStart side`);
  return leaf;
};

/** `padding` refuses a negative measurement; `margin` allows one. */
const PADDING = side("padding");
const MARGIN = side("margin");
const OPACITY = entry("opacity").shape as unknown as StyleLeaf;

/** `position.zIndex` is a union; its number arm is an UNBOUNDED integer. */
const Z_INDEX: StyleLeaf = (() => {
  const fields = entry("position").shape.fields as Record<
    string,
    { of?: readonly Record<string, unknown>[] }
  >;
  const arm = fields.zIndex?.of?.find(candidate => candidate.kind === "number");
  if (arm === undefined) throw new Error("position.zIndex has no number arm");
  return arm as unknown as StyleLeaf;
})();

describe("the CSS number grammar", () => {
  /*
   * Its docblock states three properties and nothing asserted any of them, so
   * a correction to the pattern could quietly change what every consumer
   * accepts. Two consumers now share it — the numeric style controls and the
   * fonts panel's `font-weight` field — and the second reaches a stylesheet,
   * where a spelling CSS cannot parse costs the whole declaration.
   */
  it("refuses the radix spellings `Number` accepts", () => {
    // Each converts to a finite number in range, so a bounds check applied
    // after conversion passes while the stored string stays unparseable.
    for (const spelling of ["0x190", "0b110001000", "0o620"]) {
      expect(CSS_NUMBER.test(spelling), spelling).toBe(false);
      expect(Number.isFinite(Number(spelling)), `${spelling} via Number`).toBe(
        true
      );
    }
  });

  it("requires a digit AFTER a decimal point", () => {
    // The tokenizer consumes `.` only when a digit follows, so `400.` is a
    // number followed by a stray delimiter rather than a number.
    expect(CSS_NUMBER.test("400.")).toBe(false);
    expect(CSS_NUMBER.test("400.0")).toBe(true);
    expect(CSS_NUMBER.test(".5")).toBe(true);
  });

  it("keeps the sign and exponent forms, which CSS does allow", () => {
    // The control. A pattern narrowed to plain digits refuses every one of
    // these, and each is a spelling a free-text field really receives.
    for (const spelling of ["400", "+400", "-400", "1e3", "1E3", ".5e3"]) {
      expect(CSS_NUMBER.test(spelling), spelling).toBe(true);
    }
  });

  it("refuses what is not a number at all", () => {
    for (const spelling of ["", ".", "1e", "4_00", "Infinity", "70O"]) {
      expect(CSS_NUMBER.test(spelling), spelling).toBe(false);
    }
  });
});

describe("what a measurement is", () => {
  it("decomposes a single measurement into its number and unit", () => {
    expect(measurementOf("16px")).toMatchObject({ number: 16, unit: "px" });
    expect(measurementOf("50%")).toMatchObject({ number: 50, unit: "%" });
    expect(measurementOf("-4px")).toMatchObject({ number: -4, unit: "px" });
  });

  it("holds a stored NUMBER to the same round trip as a written one", () => {
    // `line-height` stores a number, and `1e-7` printed back is `"1e-7"` —
    // which the text path declines because composing it yields `0`. Read
    // directly, the number branch answered `decimals: 0` and a step discarded
    // the quantity entirely. The two paths must agree because they are one
    // question.
    expect(measurementOf(1e-7)).toBeUndefined();
    expect(measurementOf("1e-7")).toBeUndefined();
  });

  it("reads a stored NUMBER as a measurement with no unit", () => {
    // `number` leaves store numbers rather than strings, so reading only
    // strings would leave every opacity and line-height unsteppable while
    // looking supported.
    expect(measurementOf(0.5)).toMatchObject({ number: 0.5, unit: "" });
  });

  it.each([
    ["auto", "a keyword"],
    ["inherit", "a CSS-wide keyword"],
    ["10px 20px", "a two-part shorthand"],
    ["clamp(1rem, 2vw, 3rem)", "a function"],
    ["calc(100% - 2rem)", "an expression"],
    ["", "nothing"],
    ["1.", "a number CSS does not spell"],
  ])("refuses to decompose %s (%s)", text => {
    // Each of these is a value the engine accepts somewhere, so answering with
    // a number would let a numeric field claim it and write it away.
    expect(measurementOf(text)).toBeUndefined();
  });

  it("refuses to decompose any object at a scalar position", () => {
    // A token reference is the one that matters — `{ $token }` is one value
    // spelled as a record — but the guard that stops it is the plain
    // not-a-string test, which is why an imported `{ value: "12px" }` is
    // refused by the same line. Asserted together rather than as a token case
    // alone: a token-shaped assertion here would pass whether or not anything
    // in the module knew what a token was.
    expect(measurementOf({ $token: "space.4" })).toBeUndefined();
    expect(measurementOf({ value: "12px" } as never)).toBeUndefined();
    // The two above are refused by the REGEX as much as by the type test —
    // both stringify to "[object Object]", which matches nothing — so neither
    // can tell a guard that branches on type from one that does not. This one
    // can: it stringifies to a value the regex would accept, so it decomposes
    // the moment the type test stops being made. Without it the assertions
    // above are a regression guard on the outcome and no coverage of the line
    // that produces it.
    const stringifies = { toString: () => "16px" } as never;
    expect(measurementOf(stringifies)).toBeUndefined();
  });

  it.each([
    ["9007199254740993", "an integer past the safe range"],
    ["1e-3", "exponent notation"],
    ["1e-7", "an exponent JavaScript itself prints back"],
    [".5", "a leading point"],
    ["+5", "an explicit plus"],
    ["1.50", "a trailing zero"],
  ])("declines %s (%s), which the composer cannot reproduce", digits => {
    // The engine accepts all four. A double changes each of them — the first
    // comes back SMALLER than it started — so composing one writes a value the
    // author never typed. Asserted as one family rather than one case, because
    // they were found one at a time and nothing says the list is closed.
    expect(measurementOf(`${digits}px`)).toBeUndefined();
  });

  it("keeps the author's precision rather than the double's", () => {
    // Two decimals because two were written. The double alone reports one, so
    // a step of `0.05` read from it would round to `1.3` instead of `1.25`.
    expect(measurementOf("1.25rem")).toMatchObject({
      number: 1.25,
      decimals: 2,
    });
  });
});

describe("stepping a dimension", () => {
  it("keeps the unit, so a step is an edit and not a change of kind", () => {
    expect(steppedValue(PADDING, "8px", 1)).toBe("9px");
    expect(steppedValue(PADDING, "2rem", -1)).toBe("1rem");
  });

  it("asks the ENGINE whether the result is legal, per property", () => {
    // The separating assertion of this file. Same value, same step, opposite
    // answers — and the only thing that differs is what the catalog says about
    // negatives. A rule written into the module would have to answer both the
    // same way.
    expect(steppedValue(PADDING, "0px", -1)).toBeUndefined();
    expect(steppedValue(MARGIN, "0px", -1)).toBe("-1px");
  });

  it.each(["auto", "clamp(1rem, 2vw, 3rem)", "10px 20px", "inherit"])(
    "leaves %s alone rather than replacing it",
    stored => {
      // The defect this module exists to prevent: a numeric control that
      // modelled the value would answer with a number here and overwrite the
      // author's value on the first keystroke.
      expect(steppedValue(PADDING, stored, 1)).toBeUndefined();
    }
  );

  it.each([
    ["9007199254740992", "a step a double cannot represent at all"],
    ["9007199254740994", "a step a double turns into two"],
  ])("declines to step %s (%s)", digits => {
    // The round-trip guard proves the STARTING value survives a double and
    // says nothing about the step. Near the safe-integer boundary the two come
    // apart: the first value plus one is the same double, so the arrow is
    // consumed and nothing happens — a key that looks dead — and the second
    // lands two away. Neither is what the author asked for.
    expect(steppedValue(PADDING, `${digits}px`, 1)).toBeUndefined();
  });

  it("rounds at the author's own precision", () => {
    // Rounded at the two decimals the value was written with. Ignored, the
    // step would round to the whole number and answer `1rem`.
    expect(steppedValue(PADDING, "1.25rem", 0.1)).toBe("1.35rem");
  });

  it("does not answer in floating point", () => {
    // `0.1 + 0.2` is `0.30000000000000004`, a valid CSS number and a value
    // nobody would choose to store.
    expect(steppedValue(PADDING, "0.1rem", 0.2)).toBe("0.3rem");
  });

  it("widens precision for a fine step off a whole number", () => {
    // Rounded to the value's own zero decimals, a 0.1 step off `1rem` would
    // land back on `1rem` and the key would appear dead.
    expect(steppedValue(PADDING, "1rem", 0.1)).toBe("1.1rem");
  });
});

describe("stepping a number leaf", () => {
  it("rests at the declared bounds rather than going past them", () => {
    // `opacity` declares min 0 and max 1. Clamping rather than refusing is what
    // a spinbutton does: holding an arrow at the maximum should rest there.
    expect(steppedValue(OPACITY, 0.9, 0.2)).toBe(1);
    expect(steppedValue(OPACITY, 0.1, -0.5)).toBe(0);
  });

  it("steps within the bounds", () => {
    expect(steppedValue(OPACITY, 0.5, 0.1)).toBe(0.6);
  });

  it.each([
    [9007199254740992, "a step a double cannot represent"],
    [9007199254740994, "a step a double turns into two"],
  ])("declines to step %s (%s) on a number leaf too", stored => {
    // `z-index` is an unbounded integer leaf, so the same arithmetic that
    // defeats a dimension defeats it — and the dimension path's guard does not
    // run here. Asserted against a REAL catalog leaf rather than the bounded
    // `opacity`, because a min/max would clamp before the arithmetic showed.
    expect(steppedValue(Z_INDEX, stored, 1)).toBeUndefined();
  });

  it("still rests at a declared bound, which is not a failed step", () => {
    // Clamping must stay exempt: resting at the maximum is the right answer to
    // a step, and requiring movement there would kill the arrow exactly at the
    // ends, where a spinbutton is most often held.
    expect(steppedValue(OPACITY, 0.9, 0.2)).toBe(1);
    expect(steppedValue(OPACITY, 0.1, -0.5)).toBe(0);
  });

  it("refuses a value carrying a unit, which is not a number", () => {
    // `opacity: 5px` is stored text the engine refuses; stepping it would
    // answer `6px`, which it also refuses.
    expect(steppedValue(OPACITY, "5px", 1)).toBeUndefined();
  });
});

describe("units offered", () => {
  it("offers only units the property accepts", () => {
    const units = unitChoicesFor(PADDING);
    expect(units).toContain("px");
    expect(units).toContain("rem");
    // `padding` resolves percentages, so `%` earns its place.
    expect(units).toContain("%");
  });

  it("offers none for a leaf that is not a dimension", () => {
    expect(unitChoicesFor(OPACITY)).toEqual([]);
  });

  it("carries the number across a unit change rather than converting it", () => {
    // A conversion would need the font size and the viewport, neither knowable
    // from here. `16px` becoming `16rem` is what was asked for; inventing
    // `1rem` would be a guess dressed as help.
    expect(withUnit(PADDING, "16px", "rem")).toBe("16rem");
  });

  it("refuses a unit swap on a value it cannot decompose", () => {
    expect(withUnit(PADDING, "clamp(1rem, 2vw, 3rem)", "px")).toBeUndefined();
  });
});

describe("a toggle is a projection of a keyword leaf", () => {
  // NO CATALOG PROPERTY DECLARES A TWO-VALUE KEYWORD LEAF, verified by walking
  // every entry in `STYLE_CATALOG` including nested shapes. So the leaf below
  // is constructed, and what these assertions cover is the PROJECTION —
  // whether a vocabulary of this shape is offered as a toggle — and not that a
  // toggle reaches the panel for any block a site can use, which today it does
  // not. Said here rather than left to be inferred: a reader meeting a green
  // suite is entitled to know which half of the claim it stands behind.
  const two: StyleLeaf = {
    kind: "keyword",
    cssProperty: "font-style",
    tokenKinds: [],
    values: ["normal", "italic"],
    maxParts: 1,
  } as unknown as StyleLeaf;

  it("offers both options when the whole vocabulary is two keywords", () => {
    expect(toggleOptionsFor(two)).toEqual(["normal", "italic"]);
  });

  /*
   * Three fits too. The rule was never "two is special" — the docblock's own
   * condition is that the WHOLE vocabulary fits in the control, so a keyword
   * offering three short values is offered whole rather than folded into a menu
   * an author has to open to see three words.
   */
  it("offers all three when the whole vocabulary is three short keywords", () => {
    const three = {
      kind: "keyword",
      values: ["normal", "italic", "oblique"],
    } as unknown as StyleLeaf;

    expect(toggleOptionsFor(three)).toEqual(["normal", "italic", "oblique"]);
  });

  /*
   * Length decides as well as count, because the control is a row in a rail an
   * author can drag narrow. Three long words do not fit side by side, and a
   * segmented control that wraps to three lines is worse than the menu it
   * replaced — it takes more height AND still has to be read word by word.
   */
  it("declines three keywords too long to sit side by side", () => {
    const long = {
      kind: "keyword",
      values: ["nowrap", "wrap", "wrap-reverse-and-then-some"],
    } as unknown as StyleLeaf;

    expect(toggleOptionsFor(long)).toBeUndefined();
  });

  it("declines a vocabulary of four, whatever its length", () => {
    const four = {
      kind: "keyword",
      values: ["a", "b", "c", "d"],
    } as unknown as StyleLeaf;

    expect(toggleOptionsFor(four)).toBeUndefined();
  });

  it("declines a vocabulary that does not fit in the control", () => {
    // `display` has many values; drawing two of them would hide the rest.
    const display = entry("display").shape as unknown as StyleLeaf;
    expect(toggleOptionsFor(display)).toBeUndefined();
  });

  it("declines a leaf taking a shorthand of two keywords", () => {
    // `overflow: hidden auto` sets two axes. Two buttons can say one thing.
    const shorthand = { ...two, maxParts: 2 } as unknown as StyleLeaf;
    expect(toggleOptionsFor(shorthand)).toBeUndefined();
  });

  it("declines to show a stored value outside its two options", () => {
    // A CSS-wide keyword is live and compiles while matching neither button. A
    // toggle drawn over it would show one side selected and replace the value
    // on the first click.
    const options = ["normal", "italic"] as const;
    expect(toggleShows(options, "italic")).toBe(true);
    expect(toggleShows(options, undefined)).toBe(true);
    expect(toggleShows(options, "inherit")).toBe(false);
    expect(toggleShows(options, { $token: "x.y" })).toBe(false);
  });
});
