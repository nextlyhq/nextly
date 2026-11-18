import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A Form block's "+ Add field" and "+ Add option" read in the editor's text
 * colour, never its accent.
 *
 * The accent is `--nx-primary`, a fill a site's brand may set to any colour:
 * the e2e suite's indigo reads under AA's 4.5:1 as small text on the panel,
 * so text drawn in it is only as readable as the brand happens to be. The
 * editor's text token is kept readable on its panels in every theme.
 *
 * jsdom computes no stylesheet, so this reads the rule as written.
 *
 * @module styles/form-fields-add-colour.test
 */
const SHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "form-fields.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector is exactly `selector`. */
function ruleOf(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(
    SHEET
  );
  if (match === null) throw new Error(`no rule for ${selector}`);
  const found = new Map<string, string>();
  for (const [, name, value] of (match[2] ?? "").matchAll(
    /([\w-]+)\s*:\s*([^;]+);/g
  )) {
    found.set(name ?? "", (value ?? "").trim());
  }
  return found;
}

describe("the Form block's add buttons", () => {
  it("read in the editor's text colour, not its accent", () => {
    const add = ruleOf(".nx-form-fields__add");
    expect(add.get("color")).toBe("var(--nx-builder-text)");
  });
});
