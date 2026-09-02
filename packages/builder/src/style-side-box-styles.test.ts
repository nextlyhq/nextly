import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * How the box of logical sides is placed, asserted against the sheet that does it.
 *
 * The panel decides WHETHER a box is drawn and marks each field with the side
 * it holds; the stylesheet decides where each one lands. jsdom applies no
 * stylesheet, so a render test can see the marks and never the arrangement —
 * these read the declarations instead, each scoped to the rule that makes it
 * rather than searched for across the file.
 *
 * @module style-side-box-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/**
 * The sheet with every run of whitespace collapsed to one space.
 *
 * Selectors are matched against this rather than against the file, because the
 * formatter wraps a selector once it passes the line width — so
 * `[data-side="inlineStart"]` sits on its own line while its three siblings do
 * not. A test that matched the raw text would be asserting where Prettier chose
 * to break a line, and would fail the day a neighbouring rule is renamed.
 */
const FLAT = CHROME.replace(/\s+/g, " ");

/**
 * The declarations of one rule, found by its selector.
 *
 * @param selector - the selector text, whitespace-insensitive
 * @returns the text between that rule's braces
 */
function ruleBody(selector: string, after = ""): string {
  const flat = selector.replace(/\s+/g, " ");
  const from = after === "" ? 0 : FLAT.indexOf(after.replace(/\s+/g, " "));
  if (from === -1) throw new Error(`no anchor in the sheet: ${after}`);
  const needle = `${flat} {`;
  const open = FLAT.indexOf(needle, from);
  if (open === -1) throw new Error(`no rule for selector: ${selector}`);
  /*
   * REFUSES an ambiguous selector rather than answering with the first match.
   *
   * One selector can carry different declarations in different places — the
   * label text is clipped by the box and un-clipped again inside the container
   * query that turns the box back into rows — and a helper that silently takes
   * whichever comes first in the file reads the wrong body while looking
   * entirely correct. Caught by exactly that: an assertion about the clip
   * started failing when the un-clipping rule was added ABOVE it.
   */
  if (after === "" && FLAT.indexOf(needle, open + 1) !== -1) {
    throw new Error(
      `selector appears more than once, pass an anchor: ${selector}`
    );
  }
  const start = open + needle.length;
  const close = FLAT.indexOf("}", start);
  if (close === -1) throw new Error(`unterminated rule: ${selector}`);
  return FLAT.slice(start, close);
}

const BOX = ".nx-style-inspector__side-box";

describe("the box places sides by identity", () => {
  it.each([
    ["blockStart", "1 / 2"],
    ["inlineStart", "2 / 1"],
    ["inlineEnd", "2 / 3"],
    ["blockEnd", "3 / 2"],
  ])("puts %s at row/column %s", (side, area) => {
    /*
     * Placed by WHICH SIDE the field is, never by its position among the
     * children. The property heading, a form selector and the notice for a
     * withdrawn property are all siblings of the four sides, so a rule counting
     * elements moves every side the moment one of them appears — and the sides
     * would then be drawn on edges they do not describe, which is worse than
     * not drawing a box at all.
     */
    expect(ruleBody(`${BOX} > [data-side="${side}"]`)).toContain(
      `grid-area: ${area}`
    );
  });

  it("uses no positional selector to place a side", () => {
    /*
     * The control for the four assertions above: they would all pass with an
     * `nth-of-type` chain sitting beside them doing the real work. The sheet
     * must not contain one for this box at all.
     */
    expect(FLAT).not.toContain(`${BOX} > .nx-inspector__field:nth-of-type`);
    expect(FLAT).not.toContain(`${BOX} > *:nth-child`);
  });
});

describe("the box keeps its contents readable", () => {
  it("uses the element's axes through a RULE, not an inline declaration", () => {
    /*
     * An inline `writing-mode` outranks every selector, so the narrow fallback
     * could only take the axes back by shouting — and the reviewed cap on
     * `!important` in this codebase exists precisely to stop that becoming the
     * ordinary way to override something. Handed over as values instead, the
     * property is set by this rule and the fallback wins on order.
     */
    // Anchored on the box's own comment: this selector now carries two rules,
    // the default and the narrow fallback, and the helper refuses to guess.
    const box = ruleBody(BOX, "A per-side property drawn as the box");

    expect(box).toContain("writing-mode: var(--nx-side-writing-mode");
    expect(box).toContain("direction: var(--nx-side-direction");
  });

  it("puts the children back into the PANEL's axes", () => {
    /*
     * The grid carries the edited element's writing mode so its placement
     * resolves there, and that property is inherited — so without this a
     * vertical-writing page would rotate the text inside every input in the
     * box. The orientation decides where a control sits, never how its own
     * content reads.
     *
     * Taken from a custom property rather than written as `ltr`, so the day the
     * admin itself runs right-to-left there is one declaration to change.
     */
    const children = ruleBody(`${BOX} > *`);

    expect(children).toContain("var(--nx-chrome-writing-mode");
    expect(children).toContain("var(--nx-chrome-direction");
  });

  it("declares those chrome axes once, on the inspector itself", () => {
    const inspector = ruleBody(".nx-inspector");

    expect(inspector).toContain("--nx-chrome-writing-mode:");
    expect(inspector).toContain("--nx-chrome-direction:");
  });

  it("hides only the label's TEXT, so the provenance dot survives", () => {
    /*
     * Inside a box the side is told by position and the words are noise — but
     * the label also carries the provenance dot, which says whether this side
     * is authored or inherited and is not something position can tell anyone.
     * Clipping the whole label takes the dot and its focus-revealed explanation
     * with it, which is why the words are wrapped and the wrapper is what is
     * clipped.
     */
    expect(
      ruleBody(
        `${BOX} .nx-style-inspector__field-label-text`,
        // Anchored past the container query, which un-clips the same element
        // when the box gives up and becomes rows.
        "A side is a control alone"
      )
    ).toContain("clip-path: inset(50%)");
    // And NOT the label itself, which would take the dot with it.
    expect(FLAT).not.toContain(`${BOX} > [data-side] > :first-child {`);
  });
});

describe("the narrow fallback actually wins", () => {
  it("is declared AFTER the rules it overrides", () => {
    /*
     * Order, not merely presence. These selectors have the same specificity as
     * the box's own, so whichever comes last in the sheet decides — and written
     * earlier the base rule restores `display: grid` and the label rule restores
     * the clipping. What an author then gets at a narrow rail is a cramped grid
     * with neither its centre diagram nor visible labels: the fallback declared
     * and not delivered, with every assertion about its declarations passing.
     */
    const boxDisplay = FLAT.indexOf("A per-side property drawn as the box");
    // The box's OWN fallback, not the field-stacking query that shares its
    // threshold and appears earlier: `indexOf` finds that one and would compare
    // against a block with nothing to do with this.
    const fallback = FLAT.indexOf(`${BOX} { display: flex`);
    expect(boxDisplay).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(boxDisplay);
  });

  it("puts the PANEL's axes back, so a stacked column runs downward", () => {
    /*
     * The box carries the edited element's writing mode so its grid resolves
     * there, and `flex-direction: column` follows that same block axis — which
     * is HORIZONTAL in a vertical writing mode, so the promised stack would run
     * sideways.
     *
     * Plain declarations are enough because the element's axes are used through
     * a rule rather than applied inline: this block is later in the sheet and
     * carries the same specificity, so it wins on order. Had they been applied
     * inline, no selector could have outranked them and the sheet would have
     * had to shout — which is what the last assertion here refuses.
     */
    const fallback = FLAT.slice(FLAT.indexOf(`${BOX} { display: flex`));
    expect(fallback).toContain("flex-direction: column");
    expect(fallback).toContain(
      "writing-mode: var(--nx-chrome-writing-mode, horizontal-tb)"
    );
    expect(fallback).toContain("direction: var(--nx-chrome-direction, ltr)");
    // And WITHOUT shouting: the cap on `!important` here is a real constraint,
    // and needing one would have meant the axes were applied in the wrong place.
    expect(fallback).not.toContain("!important");
  });
});
