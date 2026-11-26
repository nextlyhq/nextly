import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "../styles/chrome-stylesheet";

/**
 * Which faded block toolbar lets a press through to the block under it,
 * asserted against the sheet that decides it.
 *
 * jsdom applies no stylesheet, so the toolbar's own tests can only see the
 * marker it sets. Whether a press lands on a hidden button or on the block
 * beneath is the sheet's `pointer-events`, so that is held here: the plausible
 * broken sheet keys the rule to one side the bar is drawn on, which leaves a
 * bar drawn above the selection pressing a button the author cannot see.
 *
 * @module block-toolbar-fade-styles.test
 */
const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/** Every rule as its selector and body, with comments taken out. */
function rules(): { selector: string; body: string }[] {
  const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

/** The rules that set `pointer-events` on the toolbar or anything in it. */
function pointerRules(): { selector: string; body: string }[] {
  return rules().filter(
    rule =>
      rule.selector.includes(".nx-block-toolbar") &&
      /pointer-events:/.test(rule.body)
  );
}

describe("the block toolbar and the pointer", () => {
  it("takes the pointer, gaps and edges included, while it is shown", () => {
    const bar = pointerRules().find(
      rule => rule.selector === ".nx-block-toolbar"
    );
    expect(bar?.body).toMatch(/pointer-events:\s*auto/);
  });

  it("lets it through, buttons included, wherever it is marked to, on every side", () => {
    const passing = pointerRules().filter(rule =>
      rule.selector.includes("[data-lets-through]")
    );
    expect(passing).toHaveLength(1);
    expect(passing[0]?.body).toMatch(/pointer-events:\s*none/);
    // On the bar itself, so the inherited value reaches every button.
    expect(passing[0]?.selector).toBe(
      ".nx-block-toolbar[data-lets-through]:not(:focus-within)"
    );
  });

  it("never hands the pointer back to a button on its own", () => {
    // A child rule setting `auto` would undo the inherited `none`: a press
    // over a covered block would land on a button the author cannot see.
    const children = pointerRules().filter(
      rule =>
        rule.selector.includes(".nx-block-toolbar ") &&
        /pointer-events:\s*auto/.test(rule.body)
    );
    expect(children).toEqual([]);
  });

  it("keeps the pointer while it is only faded, so its buttons can be reached", () => {
    // Faded alone is over the selection's own parent, where a pointer heading
    // for the bar comes from.
    const fadedOnly = pointerRules().filter(
      rule =>
        rule.selector.includes("[data-faded]") &&
        /pointer-events:\s*none/.test(rule.body)
    );
    expect(fadedOnly).toEqual([]);
  });
});
