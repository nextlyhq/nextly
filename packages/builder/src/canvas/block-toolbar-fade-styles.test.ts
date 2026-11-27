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
function rules(source: string = CHROME): { selector: string; body: string }[] {
  const sheet = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

/** The rules that set `pointer-events` on the toolbar or anything in it. */
function pointerRules(
  source: string = CHROME
): { selector: string; body: string }[] {
  return rules(source).filter(
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
    // A rule for anything in the bar setting `auto` would undo the inherited
    // `none`: a press over a covered block would land on a button the author
    // cannot see. Anything but the bar's own rules: its buttons by class or
    // by element, and whatever else it holds.
    const handingBack = (source: string) =>
      pointerRules(source).filter(
        rule =>
          rule.selector
            .split(",")
            .map(part => part.trim())
            .some(part =>
              /\.nx-block-toolbar(?:__|[^\w-[]|\[[^\]]*\]\s)/.test(part)
            ) && /pointer-events:\s*auto/.test(rule.body)
      );
    expect(handingBack(CHROME)).toEqual([]);
    // The control: the rule that would undo it is caught, by class and by
    // element.
    for (const added of [
      ".nx-block-toolbar__button { pointer-events: auto; }",
      ".nx-block-toolbar button { pointer-events: auto; }",
    ]) {
      expect(handingBack(`${CHROME}\n${added}`), added).toHaveLength(1);
    }
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
