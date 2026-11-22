import { SLOTS_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";

/**
 * The canvas's stylesheet keys the empty-container affordance off markers —
 * `SLOTS_ATTRIBUTE` from `@nextlyhq/blocks-react` and this package's own
 * chrome and canvas classes — and a stylesheet has no module system, so it
 * cannot import those constants. Its selectors spell them out as literal
 * strings instead, which makes the CSS and the constants two independent
 * copies of one spelling: correct only for as long as nobody renames either
 * constant, and a rename is silent when it happens. TypeScript still compiles
 * — the identifier is still a valid string wherever it is used — and the
 * selector simply stops matching anything, with no failed build and no error
 * to notice. Only an author asking for the affordance discovers it is gone.
 *
 * So this file is the enforcement the CSS cannot provide for itself: every
 * selector fragment is built from the constant, the same way the runtime code
 * that consumes these markers already does (`` `[${NODE_ID_ATTRIBUTE}]` `` in
 * `canvas.tsx`), rather than retyped — so renaming a constant moves this
 * test's expectation with it, and only a stylesheet that actually fell out of
 * step fails.
 *
 * The rules on the page itself are in the sheet the canvas frame carries
 * (`canvas-frame-sheet.ts`), since the editor's own stylesheet does not reach
 * a page drawn in a frame. That sheet is a string built from the constants,
 * which makes the drift harder to write, and this still holds it to them.
 *
 * Read from the SOURCE stylesheet rather than the built one, for the same
 * reason `breakpoint-action-styles.test.ts` beside this file does: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build, which is the shape that makes CI and a laptop disagree.
 *
 * @module builder-chrome-attributes.test
 */
/** The rules applying to the page, wherever the canvas is drawn. */
const SHEET = CANVAS_FRAME_SHEET;

/**
 * One selector, whatever a formatter did to its whitespace.
 *
 * A descendant selector is a run of compounds separated by whitespace, and
 * which whitespace is a formatter's choice: Prettier breaks this rule's
 * selector across three indented lines, while the constant it is being held to
 * is a single string with single spaces. Comparing them raw would fail on the
 * newlines and read as the stylesheet having diverged.
 *
 * Applied to BOTH sides from one function, so the needle and the haystack are
 * normalised identically — a second spelling of "collapse whitespace" is the
 * drift this file exists to prevent, one level up.
 */
function collapsed(css: string): string {
  return css.replace(/\s+/g, " ");
}

/**
 * A whole rule head, matching this selector and NOTHING WIDER.
 *
 * `toContain` is one-directional and the wrong direction is the live one here.
 * A stylesheet that narrowed its rule fails a containment check, which is what
 * that check is for — but a CONSTANT that narrowed while the stylesheet kept
 * its ancestor scopes still reads as contained, since the shorter selector is
 * a suffix of the longer one. That is precisely the divergence this pair had:
 * the rule asked three conditions and the constant asked one, so the appender
 * drew controls where the box was never drawn.
 *
 * Anchoring the front closes it. A selector may only begin where the previous
 * rule or comment ended, so requiring a closing brace, a comment terminator or
 * the start of the file immediately before it means the constant has to account
 * for every compound in the rule rather than merely its tail. The trailing
 * brace is the other end of the same idea, and it is what keeps the selector's
 * own appearance in a comment further down the file from satisfying this.
 */
function ruleFor(selector: string): RegExp {
  const literal = collapsed(selector).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\}|\\*/)\\s*${literal}\\s*\\{`);
}

describe("the empty-container affordance is keyed off the exported constants", () => {
  it("matches the slots marker by the constant, not a retyped copy", () => {
    expect(SHEET).toContain(`[${SLOTS_ATTRIBUTE}]`);
  });

  it("draws its box for exactly the elements the appender draws a control on", () => {
    /*
     * The stylesheet and `EmptyContainerAppenders` cover ONE population, not
     * two that happen to agree. The appender asks `Element.matches` with this
     * constant; the stylesheet, having no module system, spells it out — so
     * this is where the copy is held to it. Without this, a stylesheet that
     * narrowed or widened its selector would leave the appender drawing
     * controls on containers carrying no box, or declining containers that
     * have one, with nothing failing either way.
     *
     * The opening brace is part of the needle, and it is what makes this an
     * assertion about a RULE. The selector is also written in prose in a
     * comment further down the file, so a bare `toContain` stays green after
     * the rule itself has been changed to key off something else — the
     * comment alone would satisfy it.
     *
     * All three of the rule's conditions ride in the constant, so a stylesheet
     * that dropped or added an ancestor scope fails here rather than leaving
     * the appender answering a narrower question than the box it stands in for.
     */
    expect(collapsed(SHEET)).toMatch(ruleFor(EMPTY_CONTAINER_SELECTOR));
  });

  it("finds nothing for a marker that was never written", () => {
    /*
     * The control. `toContain` over a file this size passes for the wrong
     * reason if the haystack were misread or the needle were a substring of
     * something else entirely — so one needle that MUST be absent establishes
     * that the search can come out empty at all.
     */
    expect(SHEET).not.toContain("[data-nx-nonexistent-marker]");
  });
});

describe("an empty container's area yields to what the block sets", () => {
  it("gives its clickable height at no specificity, so an authored min height wins", () => {
    /*
     * The area's selector outranks a block's own class, so a min height on
     * the box rule would beat the author's: an empty Section set to Full
     * screen would stay 2.75rem tall on the canvas while the page draws it
     * the screen's height. Held apart, under `:where()`, it applies only
     * where the block sets none.
     */
    const css = collapsed(SHEET);
    const box = new RegExp(
      `${ruleFor(EMPTY_CONTAINER_SELECTOR).source}[^}]*\\}`
    ).exec(css)?.[0];
    expect(box).toBeDefined();
    expect(box).not.toContain("min-height");
    expect(css).toContain(
      `:where(${EMPTY_CONTAINER_SELECTOR}) { min-height: 2.75rem; }`
    );
    // Selected, the empty block matches the selection's safeguard too, which
    // yields the same way: choosing Full screen selects the Section.
    expect(css).toMatch(
      /:where\(\.nx-canvas \[data-nx-selected\]:empty\) \{ min-height: 2px; \}/
    );
    expect(css).not.toMatch(/\*\/ \.nx-canvas \[data-nx-selected\]:empty \{/);
  });
});

describe("an empty container's marker leaves the block as styled", () => {
  /** The declarations of the empty-container rule, whitespace collapsed. */
  function markerRule(): string {
    const rule = new RegExp(
      `${ruleFor(EMPTY_CONTAINER_SELECTOR).source}([^}]*)\\}`
    ).exec(collapsed(SHEET))?.[1];
    if (rule === undefined) throw new Error("no empty-container rule");
    return rule;
  }

  it("is a dashed outline just inside the edges, taking no room", () => {
    // An outline paints outside the box model, so it adds nothing to the
    // block's size; the negative offset draws it inside the block's edges.
    const rule = markerRule();
    expect(rule).toMatch(/outline: 1px dashed /);
    expect(rule).toMatch(/outline-offset: -1px;/);
  });

  it("sets none of the properties an author styles: border, corners, ground, padding", () => {
    // The author's own background, border and radius show exactly as set,
    // and no grey tint is laid over the background colour they chose.
    const rule = markerRule();
    for (const property of [
      "border",
      "background",
      "radius",
      "padding",
      "margin",
    ]) {
      expect(rule).not.toContain(property);
    }
  });
});

describe("an empty page's body is held open in the editor alone", () => {
  it("adds the start area's room above the footer, or below the header", () => {
    // The overlay sets the room on the root only while the page holds no
    // blocks; unset, both rules add nothing.
    const css = collapsed(SHEET);
    expect(css).toContain(
      '.nx-canvas > [data-nx-region="footer"] { margin-block-start: var(--nx-canvas-start-room, 0px); }'
    );
    expect(css).toContain(
      '.nx-canvas:not(:has(> [data-nx-region="footer"])) { padding-block-end: var(--nx-canvas-start-room, 0px); }'
    );
  });
});

describe("the canvas keeps the platform's own callout for text", () => {
  it("restores the touch callout the menu trigger suppresses", () => {
    /*
     * The context menu's trigger wraps the canvas, and Radix sets
     * `-webkit-touch-callout: none` on it. That property INHERITS, so it
     * reaches the `contenteditable` inside a block — and the canvas withholds
     * the press there, so a long press on text opens neither the platform's
     * spelling and clipboard callout nor the block menu.
     *
     * Asserted here because no test that renders the editor can see it: jsdom
     * computes no inherited `-webkit-` property, and the suppression comes
     * from a library's inline style rather than from anything in this package.
     * The stylesheet is the only place the override exists, so the stylesheet
     * is where it has to be checked.
     */
    const restored = SHEET.match(/\.nx-canvas \[contenteditable\]\s*\{[^}]*\}/);
    expect(restored).not.toBeNull();
    expect(restored?.[0]).toContain("-webkit-touch-callout: default");

    // And still suppressed where the editor has marked a region uneditable
    // inside an editable one, which is a block again rather than text.
    const suppressed = SHEET.match(
      /\.nx-canvas \[contenteditable="false"\]\s*\{[^}]*\}/
    );
    expect(suppressed).not.toBeNull();
    expect(suppressed?.[0]).toContain("-webkit-touch-callout: none");
  });
});
