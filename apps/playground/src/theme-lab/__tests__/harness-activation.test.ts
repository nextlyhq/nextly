/**
 * Importing `harness.css` is necessary and not sufficient.
 *
 * Every rule in it is written `.nextly-admin[data-theme]` on purpose, so that
 * nothing applies until a theme is selected. The gallery's preview panels
 * carried `nextly-admin` but no `data-theme`, so the font and radius bridge
 * never engaged: each panel's inline variables held its theme's font stack and
 * radius, and the primitives went on rendering the default face and
 * `rounded-none`. The tokens were right and unread.
 *
 * That is the second half of a fix whose first half looked complete. The
 * stylesheet was imported, the route was guarded, and the axes still did not
 * reach the screen -- which is why this checks the ACTIVATION rather than the
 * import.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, "..", file), "utf8");

const harnessCss = read("harness.css");
const previewCard = read("ThemePreviewCard.tsx");

/**
 * The attributes every top-level `.nextly-admin…` selector in the harness
 * requires, read from the stylesheet rather than assumed.
 *
 * Reading them is what keeps this honest: if a future rule is scoped to some
 * other attribute, this list grows and the assertion below starts requiring
 * it, instead of continuing to check the one attribute someone remembered.
 */
function requiredAttributes(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/\.nextly-admin((?:\[[^\]]+\])+)/g)) {
    for (const attr of (match[1] as string).matchAll(/\[([a-z-]+)[\]=]/g)) {
      found.add(attr[1] as string);
    }
  }
  return [...found].sort();
}

/** Attributes the preview panel element sets, as written in the JSX. */
function panelAttributes(source: string): string[] {
  // The panel is the element carrying `data-testid="mode-panel"`. Its props
  // span many lines, so the region is taken from that marker to the `style=`
  // prop that closes the group.
  const start = source.indexOf('data-testid="mode-panel"');
  if (start === -1)
    throw new Error("no mode-panel element in ThemePreviewCard");
  const end = source.indexOf("style={{", start);
  if (end === -1) throw new Error("no style prop after the mode-panel marker");
  const region = source.slice(start, end);

  const found = new Set<string>();
  for (const match of region.matchAll(/(?:^|\s)(data-[a-z-]+)\s*=/g)) {
    found.add(match[1] as string);
  }
  return [...found].sort();
}

describe("harness styles activate on the preview panels", () => {
  it("finds selectors to satisfy and attributes to check", () => {
    // Both halves can go empty and leave the rule below trivially true: a
    // stylesheet whose selectors stopped matching the pattern, or a panel
    // region that no longer parses.
    expect(requiredAttributes(harnessCss).length).toBeGreaterThan(0);
    expect(panelAttributes(previewCard).length).toBeGreaterThan(2);
  });

  it("sets every attribute the harness rules require", () => {
    const required = requiredAttributes(harnessCss);
    const present = new Set(panelAttributes(previewCard));
    const missing = required.filter(attr => !present.has(attr));

    expect(
      missing,
      `The preview panel does not carry an attribute the harness stylesheet ` +
        `scopes its rules to, so those rules never apply to it. Nothing ` +
        `throws and the panel still renders -- with the default font and ` +
        `radius, while its inline variables hold the theme's own. Importing ` +
        `the stylesheet is not enough; the panel has to match its selectors.`
    ).toEqual([]);
  });
});
