/**
 * The Variables editor's stylesheet: its buttons sit at the panel's small text
 * size, and its type-size pair lays out in columns.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CHROME = readFileSync(
  new URL("./styles/builder-chrome.css", import.meta.url),
  "utf8"
);

/** The body of the one rule with exactly this selector. */
function ruleFor(selector: string): string | undefined {
  const at = CHROME.indexOf(`\n${selector} {`);
  if (at === -1) return undefined;
  const open = CHROME.indexOf("{", at);
  return CHROME.slice(open + 1, CHROME.indexOf("}", open));
}

describe("the Variables editor's styles", () => {
  it("rounds every corner with the admin's radius tokens, never a raw length", () => {
    const start = CHROME.indexOf(
      "/*\n * The Variables view of the Design panel"
    );
    const end = CHROME.indexOf(".nx-vars-import__skipped {", start);
    expect(start).toBeGreaterThan(-1);
    const block = CHROME.slice(start, end);
    expect(block.match(/border-radius:\s*\d[^;]*;/g) ?? []).toEqual([]);
  });

  it("sizes its buttons like the panel's other small controls", () => {
    // Two classes, to outrank the button's own text size.
    const body = ruleFor(".nx-vars-editor .nx-vars-editor__button");
    expect(body).toMatch(/font-size:\s*var\(--text-xs\)/);
  });

  it("lays a type size's values out as a label column and two value columns", () => {
    expect(ruleFor(".nx-vars-editor__pair")).toMatch(
      /grid-template-columns:\s*auto minmax\(0, 1fr\) minmax\(0, 1fr\)/
    );
  });
});
