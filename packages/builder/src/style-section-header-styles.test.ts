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

/** The body of every at-rule opened by `prelude`, braces matched. */
function atRuleBodies(prelude: string): string[] {
  const bodies: string[] = [];
  let from = FLAT.indexOf(`${prelude} {`);
  while (from !== -1) {
    const start = from + prelude.length + 2;
    let depth = 1;
    let at = start;
    while (depth > 0 && at < FLAT.length) {
      if (FLAT[at] === "{") depth += 1;
      if (FLAT[at] === "}") depth -= 1;
      at += 1;
    }
    bodies.push(FLAT.slice(start, at - 1));
    from = FLAT.indexOf(`${prelude} {`, at);
  }
  return bodies;
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
    // Read from the very block that turns the box into rows, by its caption
    // reset, so a reset moved outside it, or into another narrow block,
    // fails here.
    const rows = atRuleBodies(
      "@container nx-inspector-fields (max-width: 18rem)"
    ).find(body =>
      body.includes(".nx-spacing-box__caption { position: static; }")
    );
    expect(rows).toBeDefined();
    expect(rows).toContain(
      ".nx-spacing-box .nx-inspector__field { max-inline-size: none; }"
    );
  });

  it("cuts a token's name to its side and moves its Clear beside the side's actions", () => {
    // A token's name and Clear button are wider than a side: in the box the
    // name is cut to the side's width and Clear shows over the box while the
    // side is pointed at or focused, as its other actions do.
    // All three, or nothing is cut: the ellipsis needs the clip and the
    // single line.
    const name = ruleBody(".nx-spacing-box .nx-style-inspector__token > span");
    expect(name).toContain("text-overflow: ellipsis");
    expect(name).toContain("overflow: hidden");
    expect(name).toContain("white-space: nowrap");
    const clear = ruleBody(
      ".nx-spacing-box .nx-style-inspector__token > button"
    );
    expect(clear).toContain("position: absolute");
    expect(clear).toContain("opacity: 0");
    // Faded and out of the pointer's way, so it cannot take a click unseen.
    expect(clear).toContain("pointer-events: none");
    // Flush with the side: a gap between them is where a pointer moving to
    // Clear leaves the side's hover, and Clear fades before it is reached.
    // An explicit zero, and no other margin: a shorthand such as
    // `margin: 0.25rem 0 0` would reopen the gap.
    expect(clear).toContain("margin: 0;");
    expect(clear).not.toMatch(/margin-[a-z-]+:/);
    expect(clear.match(/margin:/g)).toHaveLength(1);
    expect(
      ruleBody(
        ".nx-spacing-box .nx-inspector__field:hover .nx-style-inspector__token > button, .nx-spacing-box .nx-inspector__field:focus-within .nx-style-inspector__token > button"
      )
    ).toContain("opacity: 1");
    // Shown, it takes the click it is shown for.
    expect(
      ruleBody(
        ".nx-spacing-box .nx-inspector__field:hover .nx-style-inspector__token > button, .nx-spacing-box .nx-inspector__field:focus-within .nx-style-inspector__token > button"
      )
    ).toContain("pointer-events: auto");
  });
});

describe("a token side in the narrow inspector", () => {
  it("puts Clear back in the row's flow, always shown", () => {
    const rows = atRuleBodies(
      "@container nx-inspector-fields (max-width: 18rem)"
    ).find(body =>
      body.includes(".nx-spacing-box__caption { position: static; }")
    );
    const clear =
      ".nx-spacing-box .nx-inspector__field .nx-style-inspector__token > button {";
    expect(rows).toContain(clear);
    const body = rows?.slice(
      rows.indexOf(clear),
      rows.indexOf("}", rows.indexOf(clear))
    );
    expect(body).toContain("position: static");
    expect(body).toContain("opacity: 1");
    expect(body).toContain("pointer-events: auto");
  });
});

describe("a field's Clear", () => {
  it("is a target at least 24px square, beside a list or a token", () => {
    // WCAG 2.2's minimum target size: the browser's default button around a
    // word of small text is smaller, and axe reports it.
    const clear = ruleBody(
      ".nx-style-inspector__select-clear, .nx-style-inspector__token button"
    );
    expect(clear).toContain("min-block-size: 1.5rem");
    expect(clear).toContain("min-inline-size: 1.5rem");
  });
});

describe("a style field in the narrow inspector", () => {
  it("stacks its label over its control, as every narrow field does", () => {
    // The Style tab's wider label column outranks the shared narrow rule by
    // specificity, so it has its own narrow rule after it.
    const style = FLAT.indexOf(
      ".nx-style-inspector .nx-inspector__field { grid-template-columns: minmax(0, 7.5rem) minmax(0, 1fr); }"
    );
    expect(style).toBeGreaterThan(-1);
    // At 19rem, not the shared 18rem: a 7.5rem label and a set Align items
    // row (five icons, More and Clear) need about 18.9rem side by side.
    const narrow = atRuleBodies(
      "@container nx-inspector-fields (max-width: 19rem)"
    ).filter(body =>
      body.includes(
        ".nx-style-inspector .nx-inspector__field { grid-template-columns: minmax(0, 1fr); }"
      )
    );
    expect(narrow).toHaveLength(1);
    const at = FLAT.indexOf(narrow[0] ?? "");
    expect(at).toBeGreaterThan(style);
  });
});

describe("an open style section", () => {
  it("lets a field's focus tooltip show above the section's first row", () => {
    // The shared accordion clips its content, which cut off a provenance
    // tooltip drawn above the first field.
    expect(
      ruleBody(
        '.nx-style-inspector [data-slot="accordion-content"][data-state="open"]'
      )
    ).toContain("overflow: visible");
  });
});

describe("the icon strip", () => {
  it("never shrinks to hide its last segment", () => {
    expect(ruleBody(".nx-icon-choice__strip")).toContain("flex: none");
  });

  it("looks disabled, and ignores the pointer, in a locked section", () => {
    const disabled = ruleBody(
      ".nx-icon-choice__option:disabled, .nx-icon-choice .nx-icon-choice__more:disabled, .nx-icon-choice__clear:disabled"
    );
    expect(disabled).toContain("opacity: 0.5");
    expect(disabled).toContain("cursor: not-allowed");
    expect(FLAT).toContain(".nx-icon-choice__option:not(:disabled):hover");
    expect(FLAT).not.toMatch(/\.nx-icon-choice__option:hover/);
  });
});

describe("a list field's Clear", () => {
  it("is styled by its own class, leaving the list's trigger alone", () => {
    expect(FLAT).not.toMatch(/\.nx-style-inspector__select > button/);
    expect(
      ruleBody(
        ".nx-style-inspector__select-clear, .nx-style-inspector__token button"
      )
    ).toContain("min-block-size: 1.5rem");
  });
});
