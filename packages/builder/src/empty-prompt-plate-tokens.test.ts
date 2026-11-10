// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The empty section prompt's plate takes its colours from `--nx-builder-*`
 * tokens, and the canvas layer it is drawn in is also mounted on its own,
 * without the builder shell that declares them. A token nothing declares
 * makes the declaration that reads it invalid: the plate turns transparent
 * over the site's own ground, the case it exists for.
 *
 * jsdom applies no custom properties, so the sheet is read here: every token
 * the plate reads must be declared by a top-level rule one of whose selectors
 * matches the standalone layer or an element around it.
 *
 * @module empty-prompt-plate-tokens.test
 */
// Joined as a path: under jsdom the global `URL` is the window's, which
// `fileURLToPath` refuses.
const CHROME = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "styles/builder-chrome.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/** A selector list's selectors, split at the commas outside brackets. */
function selectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      selectors.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start).trim());
  return selectors;
}

/** The sheet's top-level style rules; at-rule blocks are skipped whole. */
function topLevelRules(sheet: string): Rule[] {
  const rules: Rule[] = [];
  let at = 0;
  while (at < sheet.length) {
    const open = sheet.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; close < sheet.length && depth > 0; close += 1) {
      if (sheet[close] === "{") depth += 1;
      else if (sheet[close] === "}") depth -= 1;
    }
    const prelude = sheet.slice(at, open).trim();
    if (!prelude.startsWith("@")) {
      rules.push({
        selectors: selectorList(prelude),
        body: sheet.slice(open + 1, close - 1),
      });
    }
    at = close;
  }
  return rules;
}

const RULES = topLevelRules(CHROME);

/** The tokens the plate's own rules read. */
const PLATE_TOKENS = [
  ...new Set(
    RULES.filter(rule =>
      rule.selectors.some(selector =>
        selector.includes(".nx-empty-container-appenders__plate")
      )
    ).flatMap(rule =>
      [...rule.body.matchAll(/var\((--nx-builder-[a-z-]+)/g)].map(
        match => match[1] ?? ""
      )
    )
  ),
];

/** Whether a selector matches `element` or one of its ancestors. */
function reaches(selector: string, element: Element): boolean {
  try {
    return element.matches(selector) || element.closest(selector) !== null;
  } catch {
    return false;
  }
}

describe("the empty section prompt's plate on a canvas with no shell", () => {
  it("reads tokens, so the check below has something to check", () => {
    expect(PLATE_TOKENS).toEqual(
      expect.arrayContaining([
        "--nx-builder-surface-raised",
        "--nx-builder-border",
        "--nx-builder-text-muted",
        "--nx-builder-text",
      ])
    );
  });

  /** Whether a rule declares `token` for the plate, in this markup. */
  function declaredFor(token: string, markup: string): boolean {
    document.body.innerHTML = markup;
    const plate = document.querySelector(
      ".nx-empty-container-appenders__plate"
    );
    if (plate === null) throw new Error("no plate");
    const declaring = RULES.filter(rule =>
      new RegExp(`(^|[;\\s])${token}\\s*:`).test(rule.body)
    );
    return declaring.some(rule =>
      rule.selectors.some(selector => reaches(selector, plate))
    );
  }

  const PLATE =
    '<button class="nx-empty-container-appenders__button"><span class="nx-empty-container-appenders__plate"></span></button>';

  it.each(PLATE_TOKENS)("has %s declared inside the shell", token => {
    // The positive control: the reading below finds the shell's own scope.
    expect(
      declaredFor(
        token,
        `<div class="nx-builder-chrome"><div class="nx-canvas-layer">${PLATE}</div></div>`
      )
    ).toBe(true);
  });

  it.each(PLATE_TOKENS)("has %s declared with no shell around it", token => {
    expect(
      declaredFor(token, `<div class="nx-canvas-layer">${PLATE}</div>`)
    ).toBe(true);
  });
});
