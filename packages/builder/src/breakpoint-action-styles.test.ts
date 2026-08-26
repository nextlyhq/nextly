import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The breakpoint actions have styles, which nothing else here can check.
 *
 * A class name in a component and a selector in a stylesheet are two halves of
 * one decision that no type, render test or lint rule connects. The editor's
 * sheet is loaded beside a design system applying Preflight, which strips a
 * bare `<button>` to text — so a missing selector does not throw, does not fail
 * a render assertion, and ships an interactive control an author cannot tell
 * apart from the sentence beside it. Measured on this PR: the buttons were
 * added with no selector anywhere and every other gate stayed green.
 *
 * Read from the SOURCE stylesheet rather than the built one: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build, which is the shape that makes CI and a laptop disagree.
 *
 * @module breakpoint-action-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

describe("the breakpoint actions are styled, not merely marked", () => {
  it("gives the action button a rule of its own", () => {
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-action {");
  });

  it("gives it a hover and a visible focus ring", () => {
    /*
     * Both, because they answer to different people: hover tells a pointer the
     * text is pressable, and a focus ring is the only way a sighted keyboard
     * user locates a control that appears on some fields and not others.
     */
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-action:hover");
    expect(CHROME).toContain(
      ".nx-style-inspector__breakpoint-action:focus-visible"
    );
  });

  it("styles the visible reset fallback beside it", () => {
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-reveals");
  });

  it("finds nothing for a class that was never written", () => {
    /*
     * The control. `toContain` over a 1600-line file is exactly the assertion
     * that passes for the wrong reason if the haystack is wrong or the needle
     * is a substring of something else — so one needle that MUST be absent
     * establishes the search can come out empty.
     */
    expect(CHROME).not.toContain(".nx-style-inspector__breakpoint-nonexistent");
  });
});
