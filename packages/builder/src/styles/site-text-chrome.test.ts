/**
 * The Site text rows' styles: in the chrome stylesheet, admin tokens for every
 * colour so both themes follow, a row that gives way at the preview rather
 * than scrolling sideways, and choices at least 24px tall.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/** Every rule whose selector names the Site text rows, with its body. */
function rules(): { selector: string; body: string }[] {
  const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
  return [
    ...sheet.matchAll(
      /([^{}]*\.nx-(?:site-text|type-pair)[^{}]*)\{([^{}]*)\}/g
    ),
  ].map(match => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" }));
}

const bodyOf = (selector: string): string =>
  rules().find(rule => rule.selector === selector)?.body ?? "";

describe("the Site text rows' styles", () => {
  it("are in the chrome stylesheet", () => {
    expect(rules().length).toBeGreaterThan(5);
  });

  it("write no colour of their own, only the admin's tokens", () => {
    for (const { selector, body } of rules()) {
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  it("let the preview give way, so a row never scrolls sideways", () => {
    expect(bodyOf(".nx-site-text__preview")).toMatch(
      /text-overflow:\s*ellipsis/
    );
    expect(bodyOf(".nx-site-text__preview")).toMatch(/min-width:\s*0/);
    expect(bodyOf(".nx-site-text__row")).toMatch(/minmax\(0,\s*1fr\)/);
  });

  it("make every choice a target of at least 24px", () => {
    expect(bodyOf(".nx-site-text__option")).toMatch(/min-height:\s*24px/);
    expect(bodyOf(".nx-type-pair__action")).toMatch(/min-height:\s*24px/);
  });
});
