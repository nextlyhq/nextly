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
     */
    expect(CHROME).toContain(`${EMPTY_CONTAINER_SELECTOR} {`);
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
