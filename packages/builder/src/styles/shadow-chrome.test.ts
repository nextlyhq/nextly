/**
 * The shadow control's styles: two sizes to a row so a layer fits the panel
 * at its narrowest, admin tokens for every colour and corner, and a preview
 * card that wears only the shadow it shows.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/** Every rule whose selector names the shadow control, with its body. */
function shadowRules(): { selector: string; body: string }[] {
  const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...sheet.matchAll(/([^{}]*\.nx-shadow[^{}]*)\{([^{}]*)\}/g)].map(
    match => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" })
  );
}

describe("the shadow control's styles", () => {
  it("are in the chrome stylesheet", () => {
    expect(shadowRules().length).toBeGreaterThan(0);
  });

  it("lays a layer's sizes out two to a row, each free to shrink", () => {
    const sizes = shadowRules().find(
      rule => rule.selector === ".nx-shadow__sizes"
    );
    expect(sizes?.body).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    );
  });

  it("writes no colour or corner of its own, only the admin's tokens", () => {
    for (const { selector, body } of shadowRules()) {
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      const radius = /border-radius:\s*([^;]+)/.exec(body)?.[1];
      if (radius !== undefined) {
        expect(radius, selector).toMatch(/var\(--radius/);
      }
    }
  });

  it("keeps a shadow's editor and its colour picker inside the window, scrolling within", () => {
    // Two layers make the variable's editor taller than a laptop window, and
    // the colour picker with its custom colour open is taller still.
    const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const selector of [
      '[data-slot="popover-content"].nx-vars-editor',
      '[data-slot="popover-content"].nx-style-inspector__picker',
    ]) {
      const bodies = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(match => (match[1] ?? "").trim() === selector)
        .map(match => match[2] ?? "")
        .join(";");
      expect(bodies, selector).toMatch(
        /max-height:\s*var\(--radix-popover-content-available-height/
      );
      expect(bodies, selector).toMatch(/overflow-y:\s*auto/);
    }
  });

  it("says a colour's notes at the panel's small size, outside the inspector too", () => {
    const note = shadowRules().find(
      rule => rule.selector === ".nx-shadow .nx-inspector__note"
    );
    expect(note?.body).toMatch(/font-size:\s*var\(--text-xs\)/);
  });

  it("draws a preview card with no shadow of its own, under the one it shows", () => {
    const card = shadowRules().find(
      rule => rule.selector === ".nx-shadow__card"
    );
    expect(card?.body).toBeDefined();
    expect(card?.body).not.toMatch(/box-shadow:/);
  });
});
