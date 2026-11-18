/**
 * How the variable pieces are drawn: a variables menu always shown as a
 * menu's chevron is, with no rule left for the ◇ it replaced; a value from a
 * variable in the shared-style green; Unlink a full-size target; and a
 * variable's name kept whole before its value.
 *
 * Read from the stylesheet because jsdom applies no CSS, so no rendered test
 * can see either property.
 *
 * @module variable-choice-styles.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

// Comments dropped and whitespace folded, so a rule reads on one line.
const FLAT = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
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

/** The declarations of every rule with a selector that mentions `part`. */
function bodiesOfAny(part: string): string[] {
  const bodies: string[] = [];
  for (const match of FLAT.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").includes(part)) bodies.push(match[2] ?? "");
  }
  return bodies;
}

const declares = (selector: string, declaration: string): boolean =>
  bodiesOf(selector).some(body => body.includes(declaration));

describe("the variables menu", () => {
  it("is never hidden until hover, as the ◇ was", () => {
    const bodies = bodiesOfAny(".nx-variable-menu");
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain("opacity: 0");
      expect(body).not.toContain("pointer-events: none");
    }
  });

  it("is a 24px target, WCAG 2.2's minimum", () => {
    expect(declares(".nx-variable-menu", "inline-size: 1.5rem")).toBe(true);
    expect(declares(".nx-variable-menu", "block-size: 1.5rem")).toBe(true);
  });

  it("leaves no rule for the ◇ it replaced", () => {
    // The trigger was `.nx-variable-choice`; its list's parts keep the name
    // with a part after it (`__option`), which this leaves alone.
    expect(FLAT).not.toMatch(/\.nx-variable-choice(?![\w-])/);
    expect(FLAT).not.toMatch(/\.nx-variable-choice__menu/);
  });
});

describe("a value from a variable", () => {
  it.each([
    ".nx-style-inspector__token.nx-variable-chip",
    ".nx-style-inspector__colour-pick[data-bound]",
    ".nx-font-pick[data-bound] > .nx-font-pick__trigger",
  ])("is drawn in the shared-style green: %s", selector => {
    expect(
      declares(selector, "background: var(--nx-builder-target-shared-ground)")
    ).toBe(true);
    expect(declares(selector, "color: var(--nx-builder-target-shared)")).toBe(
      true
    );
  });

  it("has that green defined for light and for dark", () => {
    expect(FLAT.match(/--nx-builder-target-shared:/g)?.length).toBeGreaterThan(
      1
    );
    expect(
      FLAT.match(/--nx-builder-target-shared-ground:/g)?.length
    ).toBeGreaterThan(1);
  });

  it("offers Unlink as a 24px target", () => {
    expect(declares(".nx-variable-unlink", "min-block-size: 1.5rem")).toBe(
      true
    );
  });
});

describe("a held variable's chip", () => {
  it("lets a held variable's name shrink, so the field keeps the grid", () => {
    expect(declares(".nx-variable-chip__text", "contain: inline-size")).toBe(
      true
    );
  });
});

describe("a field's source, after a value is committed", () => {
  it("is held back by the row's own value for the caption's display", () => {
    // One rule: the row sets `--nx-provenance-caption: none` while quiet.
    expect(
      declares(
        ".nx-inspector__field:focus-within .nx-style-inspector__provenance-text",
        "display: var(--nx-provenance-caption, block)"
      )
    ).toBe(true);
  });
});

describe("a variable's name before its value", () => {
  it("keeps the name whole and lets the value give way, in the list and the chip", () => {
    expect(declares(".nx-variable-choice__option", "display: flex")).toBe(true);
    for (const name of [
      ".nx-variable-choice__name",
      ".nx-variable-chip__name",
    ]) {
      expect(declares(name, "flex: 0 1 auto")).toBe(true);
    }
    // In the list a value takes what is left and is cut there.
    expect(declares(".nx-variable-choice__value", "flex: 1 1 0")).toBe(true);
    expect(
      declares(".nx-variable-choice__value", "text-overflow: ellipsis")
    ).toBe(true);
    // On the chip it is whole or wraps out of sight: one line, held.
    expect(declares(".nx-variable-chip__value", "flex: 0 0 auto")).toBe(true);
    expect(declares(".nx-variable-chip__text", "flex-wrap: wrap")).toBe(true);
    expect(declares(".nx-variable-chip__text", "overflow: hidden")).toBe(true);
  });

  it("draws a fluid value's bar dashed", () => {
    expect(
      declares(".nx-variable-choice__bar[data-fluid]", "border-style: dashed")
    ).toBe(true);
  });

  it("draws a unitless field and its variables menu as one box, as a field with a unit is", () => {
    const box =
      ".nx-inspector__field:not([data-side]) > .nx-style-inspector__numeric:has(> input + .nx-variable-menu)";
    expect(declares(box, "border: 1px solid var(--nx-input)")).toBe(true);
  });
});
