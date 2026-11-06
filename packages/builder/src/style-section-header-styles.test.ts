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

describe("a jump to another tier's value", () => {
  it("sits under the label, where every other source is named", () => {
    // "From H2 defaults" sat under the label and "From Desktop" under the
    // control, on a row of its own. Under the label, beside a control that
    // spans both lines, it costs no row.
    expect(FLAT).toContain(
      '.nx-style-inspector .nx-inspector__field > [data-action="jump"] { grid-column: 1; grid-row: 2; justify-self: start; padding-inline: 0; }'
    );
    expect(FLAT).toContain(
      '.nx-style-inspector .nx-inspector__field:has(> [data-action="jump"]) > :not(label, [data-action="jump"], .nx-inspector__error) { grid-row: 1 / span 2; }'
    );
  });

  it("follows the control again where the row stacks", () => {
    const narrow = atRuleBodies(
      "@container nx-inspector-fields (max-width: 17rem)"
    ).join(" ");
    expect(narrow).toContain(
      '.nx-style-inspector .nx-inspector__field:has(> [data-action="jump"]) > :not(label, [data-action="jump"], .nx-inspector__error) { grid-row: auto; }'
    );
  });
});

describe("a length field's unit", () => {
  it("is a small suffix inside the field, the two one bordered control", () => {
    const box = ruleBody(
      ".nx-style-inspector__numeric:has(> .nx-style-inspector__unit)"
    );
    expect(box).toContain("border: 1px solid var(--nx-input)");
    expect(box).toContain("background: var(--nx-background)");
    // The field inside gives its own border up to the box.
    expect(
      ruleBody(
        ".nx-style-inspector__numeric:has(> .nx-style-inspector__unit) > :first-child"
      )
    ).toContain("border: 0");
    const unit = ruleBody(
      ".nx-style-inspector__numeric .nx-style-inspector__unit"
    );
    expect(unit).toContain("border: 0");
    expect(unit).toContain("color: var(--nx-muted-foreground)");
    expect(unit).toContain("font-size: var(--text-xs)");
  });

  it("draws a refusal's border on the whole control", () => {
    // The field gave its border up to the box, so the box shows the refusal.
    expect(
      ruleBody(
        '.nx-style-inspector__numeric:has(> .nx-style-inspector__unit):has( [aria-invalid="true"] )'
      )
    ).toContain("border-color: var(--nx-destructive)");
  });

  it("keeps four characters of the number in view beside the unit", () => {
    // A narrow control column used to cut "-0.035" to "-0.03" beside the menu.
    expect(
      ruleBody(
        ".nx-style-inspector__numeric:has(> .nx-style-inspector__unit) > :first-child"
      )
    ).toContain("min-width: calc(4ch + 1.5rem)");
  });

  it("draws the focus ring on the whole control, the field's own given up", () => {
    expect(
      ruleBody(
        ".nx-style-inspector__numeric:has(> .nx-style-inspector__unit):focus-within"
      )
    ).toContain("outline: 2px solid var(--nx-ring)");
  });
});

describe("the Font control in a style row", () => {
  it("is as tall as the lists and fields beside it", () => {
    // The shared list trigger and text field take the control-height token,
    // the density's 28px in the inspector; the picker takes the same token, so
    // it is never the one control of another height in Typography.
    expect(ruleBody(".nx-style-inspector .nx-font-pick__trigger")).toContain(
      "height: var(--nx-control-height)"
    );
  });
});

describe("a field under its form toggle", () => {
  it("hides its label's words from sight only, the toggle's row saying them", () => {
    const words = ruleBody(
      "label[data-named-above] .nx-style-inspector__field-label-text"
    );
    // Clipped, not removed: the control keeps its name for assistive
    // technology, and `display: none` would take it away.
    expect(words).toContain("clip-path: inset(50%)");
    expect(words).toContain("position: absolute");
    expect(words).not.toContain("display: none");
  });
});

describe("an inherited value's icon", () => {
  it("is ringed, dashed and muted, never filled as a chosen one is", () => {
    // More too, when the inherited value is one of its own.
    const ring = ruleBody(
      ".nx-icon-choice__option[data-inherited], .nx-icon-choice .nx-icon-choice__more[data-inherited]"
    );
    expect(ring).toContain("outline: 1px dashed var(--nx-builder-text-muted)");
    expect(ring).not.toContain("background");
  });
});

describe("an inherited colour's swatch", () => {
  it("is drawn with a dashed border, as the inherited icon is ringed", () => {
    expect(ruleBody(".nx-style-inspector__swatch[data-inherited]")).toContain(
      "border-style: dashed"
    );
  });
});

describe("an inherited value's source", () => {
  it("sits muted at the end of the label's row, wrapping to two lines before it is cut", () => {
    // Always shown, unlike the dot: it is half of what the greyed value in
    // the control means. One line in the 7rem label column cut "From section
    // · Tablet" to "From se…"; two hold it, and a longer one ends in an
    // ellipsis with the whole sentence in its tooltip.
    const source = ruleBody(".nx-style-inspector__provenance-source");
    expect(source).toContain("margin-inline-start: auto");
    expect(source).toContain("color: var(--nx-builder-text-muted)");
    expect(source).toContain("font-size: var(--text-xs)");
    expect(source).toContain("text-overflow: ellipsis");
    expect(source).toContain("-webkit-line-clamp: 2");
    expect(source).toContain("overflow-wrap: anywhere");
    expect(source).not.toContain("white-space: nowrap");
    expect(source).not.toContain("opacity: 0");
  });

  it("takes a line of its own under the label in the wide layout", () => {
    // Beside its control the label has a 7rem column, which the label and
    // its source cannot share on one line.
    expect(
      ruleBody(".nx-style-inspector .nx-inspector__field > label")
    ).toContain("flex-wrap: wrap");
    expect(FLAT).toContain(
      ".nx-style-inspector .nx-inspector__field > label > .nx-style-inspector__provenance-source { flex-basis: 100%; margin-inline-start: 0; }"
    );
    // Stacked, the label has the row to itself, so the source shares it.
    const narrow = atRuleBodies(
      "@container nx-inspector-fields (max-width: 17rem)"
    ).join(" ");
    expect(narrow).toContain(
      ".nx-style-inspector .nx-inspector__field > label > .nx-style-inspector__provenance-source { flex-basis: auto; margin-inline-start: auto; }"
    );
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
    const clear = ruleBody(".nx-style-inspector__token button");
    expect(clear).toContain("min-block-size: 1.5rem");
    expect(clear).toContain("min-inline-size: 1.5rem");
  });
});

describe("a style field's row", () => {
  it("keeps its label beside its control at the default panel width", () => {
    /*
     * One line per row, as the design draws it: stacking every label over its
     * control at the default 1440 panel (about 18.5rem of fields) doubled the
     * inspector's height. The label column is at most 7rem, so the widest icon
     * strip (five icons and More) beside it still starts where the other
     * controls do at 1440, and it gives way to
     * a control that needs the room, since an icon strip never shrinks; the
     * reset has a fixed slot at the end, whether or not the row has one, so
     * every control ends at one edge.
     */
    expect(FLAT).toContain(
      ".nx-style-inspector .nx-inspector__field { grid-template-columns: minmax(0, 7rem) minmax(min-content, 1fr) 1.5rem; }"
    );
    // Placed by name, so the shared rule below 18rem, which sends every child
    // to column 1, does not stack a style row the panel still has room for.
    expect(FLAT).toContain(
      ".nx-style-inspector .nx-inspector__field > * { grid-column: 2; }"
    );
    expect(FLAT).toContain(
      ".nx-style-inspector .nx-inspector__field > label, .nx-style-inspector .nx-inspector__field > .nx-inspector__field-name { grid-column: 1; grid-row: 1; }"
    );
    expect(FLAT).not.toContain(':not(:has(> [data-action="reset"]))');
  });

  it("keeps a list's chosen value on one line, cut rather than wrapped", () => {
    // "Semibold 600" wrapped to two lines in a 9rem list, making its row
    // twice the height of every other.
    const value = ruleBody(
      '.nx-style-inspector__select [data-slot="select-value"]'
    );
    expect(value).toContain("white-space: nowrap");
    expect(value).toContain("text-overflow: ellipsis");
    expect(value).toContain("min-width: 0");
  });

  it("stacks only below 17rem, near the panel's narrowest", () => {
    expect(
      atRuleBodies("@container nx-inspector-fields (max-width: 19rem)")
    ).toEqual([]);
    const narrow = atRuleBodies(
      "@container nx-inspector-fields (max-width: 17rem)"
    ).join(" ");
    expect(narrow).toContain(
      ".nx-style-inspector .nx-inspector__field { grid-template-columns: minmax(0, 1fr) 1.5rem; }"
    );
    expect(narrow).toContain(
      ".nx-style-inspector .nx-inspector__field > * { grid-column: 1; }"
    );
    expect(narrow).toContain(
      ".nx-style-inspector .nx-inspector__field > label, .nx-style-inspector .nx-inspector__field > .nx-inspector__field-name { grid-column: 1 / -1; }"
    );
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
      ".nx-icon-choice__option:disabled, .nx-icon-choice .nx-icon-choice__more:disabled"
    );
    expect(disabled).toContain("opacity: 0.5");
    expect(disabled).toContain("cursor: not-allowed");
    expect(FLAT).toContain(".nx-icon-choice__option:not(:disabled)");
    expect(FLAT).not.toMatch(/\.nx-icon-choice__option:hover/);
  });

  it("keeps a chosen icon's fill under the pointer", () => {
    // The hover fill is an unchosen option's; on a chosen one it would hide
    // which is chosen, since an icon has no label to carry the weight.
    const hover = FLAT.match(
      /\.nx-icon-choice__option:not\(:disabled\)[^{,]*:hover/
    )?.[0];
    expect(hover).toBeDefined();
    expect(hover).toContain(':not([aria-checked="true"])');
  });
});

describe("a list field's Clear", () => {
  it("is styled by its own class, leaving the list's trigger alone", () => {
    expect(FLAT).not.toMatch(/\.nx-style-inspector__select > button/);
    expect(ruleBody(".nx-style-inspector__token button")).toContain(
      "min-block-size: 1.5rem"
    );
  });
});

describe("a style row's reset", () => {
  it("sits at the row's end, an icon in the control's row, not a line under it", () => {
    const reset = ruleBody(
      '.nx-style-inspector .nx-inspector__field > [data-action="reset"]'
    );
    expect(reset).toContain("grid-column: 3");
    expect(reset).toContain("grid-row: 1");
    expect(reset).toContain("inline-size: 1.5rem");
    // A jump or a refusal still reads under the control, across the row.
    expect(FLAT).toContain(
      '.nx-style-inspector .nx-inspector__field > [data-action="jump"], .nx-style-inspector .nx-inspector__field > .nx-inspector__error { grid-column: 2 / -1; }'
    );
  });

  it("follows its control onto the second row when the narrow inspector stacks", () => {
    const narrow = atRuleBodies(
      "@container nx-inspector-fields (max-width: 17rem)"
    ).join(" ");
    expect(narrow).toContain(
      '.nx-style-inspector .nx-inspector__field > .nx-style-inspector__breakpoint-action[data-action="reset"] { grid-column: 2; grid-row: 2; }'
    );
    expect(narrow).toContain(
      '.nx-style-inspector .nx-inspector__field > [data-action="jump"], .nx-style-inspector .nx-inspector__field > .nx-inspector__error { grid-column: 1 / -1; }'
    );
  });

  it("stays in a spacing side's focus overlay, hidden until the side has focus", () => {
    // As specific as the row's reset, and after it, so the row's
    // `inline-grid` does not draw it under every side of the box.
    const row = FLAT.indexOf(
      '.nx-style-inspector .nx-inspector__field > [data-action="reset"] {'
    );
    const hidden = FLAT.indexOf(
      ".nx-spacing-box .nx-inspector__field > .nx-style-inspector__breakpoint-action { display: none; }"
    );
    expect(row).toBeGreaterThan(-1);
    expect(hidden).toBeGreaterThan(row);
    // Below 18rem the box is rows again, and the reset is shown in its row.
    const rows = atRuleBodies(
      "@container nx-inspector-fields (max-width: 18rem)"
    ).join(" ");
    expect(rows).toContain(
      ".nx-spacing-box .nx-inspector__field > .nx-style-inspector__breakpoint-action, .nx-spacing-box .nx-inspector__error { display: flex;"
    );
  });

  it("keeps a side's jump clear of its reset when the box shows both", () => {
    // A value stored here and shadowed by another tier earns both, and the
    // overlay drew them at one inset, the jump over the reset.
    expect(
      ruleBody(
        '.nx-spacing-box .nx-inspector__field:has(> [data-action="reset"]) > [data-action="jump"]'
      )
    ).toContain("inset-block-start: calc(100% + 2.5rem)");
  });

  it("no longer draws the words beside it, which made each set control two rows", () => {
    expect(FLAT).not.toContain(".nx-style-inspector__breakpoint-reveals");
    expect(FLAT).not.toContain(".nx-icon-choice__clear");
    expect(FLAT).not.toContain(".nx-style-inspector__select-clear");
  });
});

describe("the Content tab's Advanced", () => {
  it("draws the panel's chevron, not the browser's triangle", () => {
    const summary = ruleBody(".nx-inspector__advanced > summary");
    expect(summary).toContain("list-style: none");
    expect(FLAT).toContain(
      ".nx-inspector__advanced > summary::-webkit-details-marker { display: none; }"
    );
    expect(
      ruleBody(
        ".nx-inspector__advanced[open] > summary > .nx-inspector__advanced-chevron"
      )
    ).toContain("rotate: 90deg");
  });
});

describe("a section opening and closing", () => {
  it("eases its height and opacity out over 150ms", () => {
    // The Style tab's sections only: a plugin's own inspector in the Content
    // tab may use the shared accordion and keeps its own motion.
    // The shared accordion's 300ms in-out curve read as slow in a panel opened
    // and closed all day, and its height alone made the fields pop in.
    expect(
      ruleBody(
        '.nx-style-inspector [data-section] > [data-slot="accordion-content"][data-state="open"]'
      )
    ).toContain("animation: nx-section-open 150ms ease-out");
    expect(
      ruleBody(
        '.nx-style-inspector [data-section] > [data-slot="accordion-content"][data-state="closed"]'
      )
    ).toContain("animation: nx-section-close 150ms ease-out");
    expect(FLAT).toContain(
      "@keyframes nx-section-open { from { height: 0; opacity: 0; overflow: hidden; } to { height: var(--radix-accordion-content-height); opacity: 1; overflow: hidden; } }"
    );
    expect(FLAT).toContain(
      "@keyframes nx-section-close { from { height: var(--radix-accordion-content-height); opacity: 1; overflow: hidden; } to { height: 0; opacity: 0; overflow: hidden; } }"
    );
  });

  it("clips its fields while it moves, though an open section shows its overflow", () => {
    // An open section is overflow-visible for a field's focus tooltip; while
    // opening, that drew the fields over the headings below. The keyframes
    // hold it clipped for exactly the animation, so the open rule applies after.
    expect(
      ruleBody(
        '.nx-style-inspector [data-slot="accordion-content"][data-state="open"]'
      )
    ).toContain("overflow: visible");
  });

  it("does not move at all for an author who asks for less motion", () => {
    // As weighty as the open and closed rules, and after them, so it wins:
    // a lighter selector lost to them and the section still moved.
    expect(FLAT).toContain(
      '@media (prefers-reduced-motion: reduce) { .nx-style-inspector [data-section] > [data-slot="accordion-content"][data-state] { animation: none; } .nx-style-inspector .nx-style-inspector__section-trigger > svg { transition: none; } }'
    );
  });
});

describe("the inspector at the editor's density", () => {
  it("sizes every control to the density's height and its text to 12px", () => {
    // The shared controls size from these tokens, so pointing them at the
    // density's one height reaches every field, select and button at once.
    // On both roots: a host may draw the Style panel on its own, with no
    // inspector around it.
    const root = ruleBody(":is(.nx-inspector, .nx-style-inspector)");
    expect(root).toContain(
      "--nx-control-height: var(--nx-builder-control-height)"
    );
    expect(root).toContain(
      "--nx-control-height-sm: var(--nx-builder-control-height)"
    );
    expect(root).toContain("font-size: var(--nx-builder-font-size)");
    expect(root).toContain("line-height: var(--nx-builder-line-height)");
    expect(
      ruleBody(
        ':is(.nx-inspector, .nx-style-inspector) :is(input, textarea, button, label, [data-slot="select-trigger"])'
      )
    ).toContain("font-size: var(--nx-builder-font-size)");
  });

  it("titles a style section at 12px semibold", () => {
    const title = ruleBody(".nx-style-inspector__section-label");
    expect(title).toContain("font-size: var(--nx-builder-title-size)");
    expect(title).toContain("font-weight: var(--nx-builder-title-weight)");
  });

  it("sizes the controls that set their own size to the density too", () => {
    // A row's name that is not a <label>, the Advanced toggle and the font
    // picker each kept their own size beside the 28px, 12px rows.
    expect(ruleBody(".nx-inspector__field-name")).toContain(
      "font-size: var(--nx-builder-font-size)"
    );
    const advanced = ruleBody(".nx-inspector__advanced > summary");
    expect(advanced).toContain("font-size: var(--nx-builder-title-size)");
    expect(advanced).toContain("font-weight: var(--nx-builder-title-weight)");
    expect(ruleBody(".nx-style-inspector .nx-font-pick__trigger")).toContain(
      "height: var(--nx-control-height)"
    );
  });

  it("keeps a field's text inside its 28px, and every control at that height", () => {
    // The shared input's 10px vertical padding left about 6px for a 16px line
    // at 28px; a placement row kept a 40px floor; a segmented button came out
    // at 26px from its own padding.
    const input = ruleBody(
      ':is(.nx-inspector, .nx-style-inspector) input[data-slot="input"]'
    );
    expect(input).toContain("padding-block: 0");
    expect(input).toContain("line-height: var(--nx-builder-line-height)");
    // A placement row's name cell takes the control height: pinned in
    // instance-inspector-styles.test.ts with the row's grid.
    const segment = ruleBody(".nx-style-inspector__toggle > button");
    expect(segment).toContain("height: var(--nx-control-height)");
    expect(segment).toContain("padding: 0 0.5rem");
  });

  it("sets notes at the density's text size and rows its gap apart", () => {
    expect(ruleBody(".nx-inspector__note")).toContain(
      "font-size: var(--nx-builder-font-size)"
    );
    expect(ruleBody(".nx-inspector__fields")).toContain(
      "gap: var(--nx-builder-row-gap)"
    );
  });
});

describe("a rich-text field in the Content tab", () => {
  it("is drawn as a field at least the control's height", () => {
    // An unstyled element is as tall as its one 16px line, or nothing when
    // empty: under the 24px a target needs, which axe refused.
    const field = ruleBody(".nx-inspector__rich-text");
    expect(field).toContain("min-height: var(--nx-control-height)");
    expect(field).toContain("border: 1px solid var(--nx-input)");
    expect(field).toContain("cursor: text");
    expect(ruleBody(".nx-inspector__rich-text:focus-visible")).toContain(
      "outline: 2px solid var(--nx-ring)"
    );
  });
});

describe("the inspector's Content and Style tabs", () => {
  it("are underlined tabs, set at the start of the panel, over one divider", () => {
    // Tabs, not a segmented control: Content and Style are two views of one
    // block, not a choice of value, and the choices beside them are drawn
    // differently on purpose.
    const list = ruleBody(".nx-inspector__tablist");
    expect(list).toContain("justify-content: flex-start");
    expect(list).toContain("height: var(--nx-builder-control-height)");
    // The builder's border token, which more contrast promotes.
    expect(list).toContain(
      "border-block-end: 1px solid var(--nx-builder-border)"
    );
    expect(list).toContain("background: transparent");
    const tab = ruleBody(".nx-inspector__tab");
    expect(tab).toContain("flex: none");
    expect(tab).toContain("font-size: var(--nx-builder-font-size)");
    expect(tab).toContain("font-weight: 600");
    expect(tab).toContain("border-block-end: 2px solid transparent");
    expect(tab).toContain("color: var(--nx-muted-foreground)");
    const active = ruleBody('.nx-inspector__tab[data-state="active"]');
    expect(active).toContain(
      "color: var(--nx-builder-text, var(--nx-foreground))"
    );
    expect(active).toContain("border-block-end-color: var(--nx-foreground)");
    expect(ruleBody(".nx-inspector__tab:focus-visible")).toContain(
      "outline: 2px solid var(--nx-ring)"
    );
  });

  it("keeps the open tab's line in forced colours", () => {
    // Forced colours replace the palette; the line is named in system colours
    // so the open tab stays marked.
    expect(FLAT).toContain(
      '@media (forced-colors: active) { .nx-inspector__tab[data-state="active"] { border-block-end-color: CanvasText; } }'
    );
  });
});

describe("a passage field that cannot be edited here", () => {
  it("is drawn muted, not as a field waiting for input", () => {
    // Held while the canvas edits the same passage, or with no editor.
    const held = ruleBody('.nx-inspector__rich-text[aria-readonly="true"]');
    expect(held).toContain("background: var(--nx-muted)");
    expect(held).toContain("border-color: var(--nx-border)");
  });
});
