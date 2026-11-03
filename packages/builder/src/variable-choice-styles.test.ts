/**
 * The ◇'s hidden state in the stylesheet: faded AND out of hit testing, so a
 * hidden ◇ over a neighbouring side of a box cannot take the click meant for
 * it, and both back together wherever the ◇ is revealed.
 *
 * Read from the stylesheet because jsdom applies no CSS, so no rendered test
 * can see either property.
 *
 * @module variable-choice-styles.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Comments dropped and whitespace folded, so a rule reads on one line.
const FLAT = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

/** The declarations of every rule whose selector list includes `selector`. */
function bodiesOf(selector: string): string[] {
  const bodies: string[] = [];
  for (const match of FLAT.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map(each => each.trim());
    if (selectors.includes(selector)) bodies.push(match[2] ?? "");
  }
  if (bodies.length === 0) throw new Error(`no rule for: ${selector}`);
  return bodies;
}

const declares = (selector: string, declaration: string): boolean =>
  bodiesOf(selector).some(body => body.includes(declaration));

describe("a hidden ◇ takes no clicks", () => {
  it.each([
    ".nx-style-inspector__numeric .nx-variable-choice",
    ".nx-style-inspector__select .nx-variable-choice",
    "[data-side] .nx-variable-choice",
  ])("is out of hit testing while hidden: %s", selector => {
    expect(declares(selector, "opacity: 0")).toBe(true);
    expect(declares(selector, "pointer-events: none")).toBe(true);
  });

  it.each([
    ".nx-style-inspector__numeric:hover .nx-variable-choice",
    ".nx-style-inspector__numeric:focus-within .nx-variable-choice",
    ".nx-variable-choice[data-bound]",
    ".nx-variable-choice[data-empty]",
    '.nx-variable-choice[data-state="open"]',
    "[data-side]:hover .nx-variable-choice",
    "[data-side]:focus-within .nx-variable-choice",
    '[data-side] .nx-variable-choice[data-state="open"]',
  ])("takes clicks again wherever it shows: %s", selector => {
    expect(declares(selector, "opacity: 1")).toBe(true);
    expect(declares(selector, "pointer-events: auto")).toBe(true);
  });
});
