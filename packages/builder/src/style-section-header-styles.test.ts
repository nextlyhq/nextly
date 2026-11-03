/**
 * The style sections' headings, as the stylesheet draws them.
 *
 * The shared accordion draws its chevron pointing down and turns it up when
 * open. The inspector's sections point it right when closed and down when
 * open, as the design and every other disclosure in the editor do, so the
 * direction is read from the builder's own rules, which outrank the shared
 * component's utilities by sitting outside their layer.
 *
 * @module style-section-header-styles.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Comments replaced by a marker, so a rule's prose never answers for its
// declarations, while the marker still ends the text before the next rule.
const FLAT = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "*/")
  .replace(/\s+/g, " ");

/**
 * The declarations of the one rule written for exactly `selector`: preceded by
 * the end of a rule or a comment, so the tail of a longer selector list (a
 * hover rule ending in the same selector) is not mistaken for it.
 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...FLAT.matchAll(new RegExp(`(?:}|\\*/) ${escaped} \\{`, "g")),
  ];
  if (matches.length === 0)
    throw new Error(`no rule for selector: ${selector}`);
  if (matches.length > 1) {
    throw new Error(`selector appears more than once: ${selector}`);
  }
  const start = (matches[0]?.index ?? 0) + (matches[0]?.[0].length ?? 0);
  return FLAT.slice(start, FLAT.indexOf("}", start));
}

describe("a style section's heading", () => {
  it("points its chevron right while closed and down while open", () => {
    expect(ruleBody(".nx-style-inspector__section-trigger > svg")).toContain(
      "rotate: -90deg"
    );
    expect(
      ruleBody('.nx-style-inspector__section-trigger[data-state="open"] > svg')
    ).toContain("rotate: 0deg");
  });

  it("is not underlined on hover, which reads as a link", () => {
    expect(ruleBody(".nx-style-inspector__section-trigger:hover")).toContain(
      "text-decoration: none"
    );
  });
});

describe("a field's provenance dot", () => {
  it("waits for its field to be pointed at or focused, and stays in the accessibility tree", () => {
    // The section heading's dot says which sections hold values at a glance;
    // a dot on every field beside it was the noise the design leaves out.
    // Faded rather than hidden: `visibility: hidden` or `display: none` would
    // also take the dot's spoken label away.
    const resting = ruleBody(".nx-style-inspector__provenance");
    expect(resting).toContain("opacity: 0");
    expect(resting).not.toContain("visibility");
    expect(
      ruleBody(
        ".nx-inspector__field:hover .nx-style-inspector__provenance, .nx-inspector__field:focus-within .nx-style-inspector__provenance"
      )
    ).toContain("opacity: 1");
  });
});

describe("the spacing box", () => {
  it("draws a side's action and a refusal over the box, bounded to the inspector", () => {
    // Inside a 3.5rem side, a sentence became a tall column and pushed the
    // rings apart; unbounded, it ran past the panel's edge.
    const overlay = ruleBody(
      ".nx-spacing-box .nx-inspector__field:focus-within .nx-style-inspector__breakpoint-action, .nx-spacing-box .nx-inspector__error"
    );
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("max-inline-size: 12rem");
    expect(overlay).toContain("white-space: normal");
    // A side at the inline end opens toward the middle of the inspector.
    expect(
      ruleBody(
        '.nx-spacing-box [data-side="inlineEnd"] .nx-style-inspector__breakpoint-action, .nx-spacing-box [data-side="inlineEnd"] .nx-inspector__error'
      )
    ).toContain("inset-inline-end: 0");
  });

  it("gives a side its row's whole width when the narrow inspector draws rows", () => {
    const narrow = FLAT.slice(
      FLAT.indexOf("@container nx-inspector-fields (max-width: 18rem)")
    );
    expect(narrow).toMatch(
      /\.nx-spacing-box \.nx-inspector__field \{ max-inline-size: none; \}/
    );
  });
});

describe("a field's Clear", () => {
  it("is a target at least 24px square, beside a list or a token", () => {
    // WCAG 2.2's minimum target size: the browser's default button around a
    // word of small text is smaller, and axe reports it.
    const clear = ruleBody(
      ".nx-style-inspector__select > button, .nx-style-inspector__token button"
    );
    expect(clear).toContain("min-block-size: 1.5rem");
    expect(clear).toContain("min-inline-size: 1.5rem");
  });
});
