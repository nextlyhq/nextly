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

describe("a side of a box", () => {
  it("draws its ◇ inside the side, never over the label or the side above", () => {
    const body = bodiesOf(
      ".nx-style-inspector__side-box .nx-variable-choice"
    ).join(" ");
    expect(body).toContain("position: absolute");
    expect(body).toContain("inset-inline-end:");
    expect(body).toContain("inset-block-start:");
    expect(body).not.toContain("inset-block-end: 100%");
  });

  it("keeps a held variable's clear out of the name's way until the side is pointed at or focused", () => {
    const body = bodiesOf(
      ".nx-spacing-box .nx-style-inspector__token.nx-variable-chip > button"
    ).join(" ");
    // Out of the flow, so the name has the side's whole width at rest, and
    // inside the chip rather than over the box below.
    expect(body).toContain("position: absolute");
    expect(body).toContain("inset-block-start: 0");
    expect(body).toContain("inset-inline-end: 0");
    expect(body).toContain("opacity: 0");
    expect(body).toContain("pointer-events: none");
    // The box's own reveal for a side's clear, on hover and on focus.
    for (const reveal of [
      ".nx-spacing-box .nx-inspector__field:hover .nx-style-inspector__token > button",
      ".nx-spacing-box .nx-inspector__field:focus-within .nx-style-inspector__token > button",
    ]) {
      expect(declares(reveal, "opacity: 1")).toBe(true);
      expect(declares(reveal, "pointer-events: auto")).toBe(true);
    }
  });

  it("lets a held variable's name shrink, so the field keeps the grid", () => {
    expect(declares(".nx-variable-chip__text", "contain: inline-size")).toBe(
      true
    );
  });
});

describe("a field's source, after a value is committed", () => {
  it("is held back while the field is quiet, though the field has focus", () => {
    expect(
      declares(
        ".nx-inspector__field[data-provenance-quiet]:focus-within .nx-style-inspector__provenance-text",
        "display: none"
      )
    ).toBe(true);
  });
});
