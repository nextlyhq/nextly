import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SLOTS_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";
import { EMPTY_ELEMENTS_ATTRIBUTE } from "./shell-state";

/**
 * `builder-chrome.css` keys the empty-container affordance off two markers —
 * `SLOTS_ATTRIBUTE` from `@nextlyhq/blocks-react` and this package's own
 * `EMPTY_ELEMENTS_ATTRIBUTE` — and a stylesheet has no module system, so it
 * cannot import either constant. Its selectors spell them out as literal
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
 * Read from the SOURCE stylesheet rather than the built one, for the same
 * reason `breakpoint-action-styles.test.ts` beside this file does: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build, which is the shape that makes CI and a laptop disagree.
 *
 * @module builder-chrome-attributes.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

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
    expect(CHROME).toContain(`[${SLOTS_ATTRIBUTE}]`);
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
    expect(collapsed(CHROME)).toMatch(ruleFor(EMPTY_CONTAINER_SELECTOR));
  });

  it("guards the affordance behind the hide-preference's attribute and value, by the constant", () => {
    expect(CHROME).toContain(`[${EMPTY_ELEMENTS_ATTRIBUTE}="hidden"]`);
  });

  it("finds nothing for a marker that was never written", () => {
    /*
     * The control. `toContain` over a file this size passes for the wrong
     * reason if the haystack were misread or the needle were a substring of
     * something else entirely — so one needle that MUST be absent establishes
     * that the search can come out empty at all.
     */
    expect(CHROME).not.toContain("[data-nx-nonexistent-marker]");
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
    const rule = CHROME.match(
      /\.nx-canvas \[contenteditable\]:not\(\[contenteditable="false"\]\)\s*\{[^}]*\}/
    );
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toContain("-webkit-touch-callout: default");
  });
});
