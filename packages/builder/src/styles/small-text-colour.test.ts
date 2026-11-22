import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The editor's small text and text-like controls read in its text colour,
 * never its accent: a Form block's "+ Add field" and "+ Add option", the
 * Add panel's link-shaped Retry, and the inspector's "set on this page" and
 * "cleared" line.
 *
 * The accent is `--nx-primary`, a fill a site's brand may set to any colour:
 * the e2e suite's indigo reads under AA's 4.5:1 as small text on the panel,
 * so text drawn in it is only as readable as the brand happens to be. The
 * editor's text token is kept readable on its panels in every theme. Icons
 * beside text keep the accent: they are not text, and their words say what
 * they mark.
 *
 * jsdom computes no stylesheet, so this reads each rule as written.
 *
 * @module styles/small-text-colour.test
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

const TEXT = "var(--nx-builder-text)";

describe("the editor's small text and text-like controls", () => {
  it("draw a Form block's add buttons in the text colour", () => {
    expect(
      ruleOf(sheet("form-fields.css"), ".nx-form-fields__add").get("color")
    ).toBe(TEXT);
  });

  it("draw the Add panel's Retry in the text colour, still underlined", () => {
    const retry = ruleOf(sheet("add-panel.css"), ".nx-insert-panel__retry");
    expect(retry.get("color")).toBe(TEXT);
    expect(retry.get("text-decoration")).toBe("underline");
  });

  it("draw the inspector's set-here and cleared line in the text colour", () => {
    const css = sheet("inspector-fields.css");
    for (const selector of [
      '.nx-inspector__source[data-source="instance"]',
      '.nx-inspector__source[data-source="cleared"]',
    ]) {
      expect(ruleOf(css, selector).get("color"), selector).toBe(TEXT);
    }
  });
});
