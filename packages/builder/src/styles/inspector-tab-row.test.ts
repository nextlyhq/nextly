import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The inspector's tab row stays at the panel's top while a long Style tab
 * scrolls under it.
 *
 * The row is sticky inside the Tabs root, and a sticky element is held only
 * within its parent's box. The panel is a scrolling flex column, so a Tabs
 * root free to shrink there takes the panel's height while its content runs
 * on past it, and the row leaves with that shorter box: measured in the
 * browser at 1440 by 640, the row sat 1354px above the panel once scrolled.
 * So the Tabs root keeps its content's height, and the panel scrolls it.
 *
 * jsdom lays nothing out, so this reads the rules as written; the browser
 * spec `builder-editing-bar` measures the row itself.
 *
 * @module styles/inspector-tab-row.test
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function sheet(name: string): string {
  return readFileSync(join(HERE, name), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
}

/** The declarations of the first rule whose selector list holds `selector`. */
function ruleOf(css: string, selector: string): Map<string, string> {
  for (const [, prelude, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (prelude ?? "").split(",").map(s => s.trim());
    if (!selectors.includes(selector)) continue;
    const found = new Map<string, string>();
    for (const [, name, value] of (body ?? "").matchAll(
      /([\w-]+)\s*:\s*([^;]+);/g
    )) {
      found.set(name ?? "", (value ?? "").trim());
    }
    return found;
  }
  throw new Error(`no rule for ${selector}`);
}

describe("the inspector's tab row while the panel scrolls", () => {
  it("sits in a Tabs root that keeps its content's height in the scrolling panel", () => {
    // The control: the panel is the scrolling flex column the row sticks in.
    const panel = ruleOf(sheet("inspector.css"), ".nx-inspector");
    expect(panel.get("display")).toBe("flex");
    expect(panel.get("overflow-y")).toBe("auto");
    expect(
      ruleOf(sheet("inspector-fields.css"), ".nx-inspector__tabrow").get(
        "position"
      )
    ).toBe("sticky");

    const tabs = ruleOf(sheet("style-inspector.css"), ".nx-inspector__tabs");
    expect(tabs.get("flex-shrink")).toBe("0");
    expect(tabs.get("min-height")).not.toBe("0");
  });
});
