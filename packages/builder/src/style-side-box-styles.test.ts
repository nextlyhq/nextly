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

const BOX = '.nx-style-inspector__property[data-sides="logical"]';

describe("the box places sides by identity", () => {
  it.each([
    ["blockStart", "2 / 2"],
    ["inlineStart", "3 / 1"],
    ["inlineEnd", "3 / 3"],
    ["blockEnd", "4 / 2"],
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

  it("leaves row one free, so a spanning heading lands ABOVE the box", () => {
    /*
     * A full-width item with no row is placed after every explicitly-placed
     * one, which puts the property's own heading UNDERNEATH its box. The sides
     * start on row two so the first full-width row is above them.
     *
     * Measured in a browser before this was so: the heading rendered below the
     * diagram it names.
     */
    expect(ruleBody(`${BOX} > [data-side="blockStart"]`)).toContain(
      "grid-area: 2 /"
    );
  });

  it("spans everything that is NOT a side across the whole box", () => {
    /*
     * Without a placement these are auto-placed into whichever cell is free —
     * the heading into the top-left corner and the notice beside it, where a
     * sentence gets a third of the panel and the first row grows into a tall
     * wrapped sliver. Addressed as "not a side" so a sibling added later is
     * spanned rather than scattered.
     */
    expect(ruleBody(`${BOX} > *:not([data-side])`)).toContain(
      "grid-column: 1 / -1"
    );
  });
});

describe("the box keeps its contents readable", () => {
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
