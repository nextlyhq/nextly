import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

/**
 * The colours of a region edited in place: the purple bar above the canvas,
 * its Done, and the dim over the rest of the page. Each comes from the
 * editor's tokens, with a value for the light theme and one for the dark,
 * and the bar's words and its Done read at WCAG AA (4.5:1) in both. The dim
 * is the editor's own well, made see-through and drawn by the chrome over
 * the page: no rule here reaches the page's own colours.
 *
 * jsdom computes no colours, so this reads the compiled sheet's sources and
 * resolves each token to the literal it names, then measures the contrast.
 *
 * @module region-editing-tokens.test
 */

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

const CHROME = stripComments(
  chromeStylesheetSource(url => readFileSync(fileURLToPath(url), "utf8"))
);

/** The body of the first rule whose prelude matches `prelude`. */
function ruleBody(prelude: RegExp): string {
  const match = prelude.exec(CHROME);
  if (match === null) throw new Error(`no rule matching ${prelude}`);
  const open = CHROME.indexOf("{", match.index);
  let depth = 1;
  let close = open + 1;
  for (; close < CHROME.length && depth > 0; close += 1) {
    if (CHROME[close] === "{") depth += 1;
    else if (CHROME[close] === "}") depth -= 1;
  }
  return CHROME.slice(open + 1, close - 1);
}

/** A custom property's declared value in a rule body. */
function declared(body: string, property: string): string | undefined {
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

/** The editor's token rules: light, dark, and the constants both read. */
const LIGHT = ruleBody(
  /^\.nx-builder-tokens,\s*\.nx-builder-chrome,\s*:where/m
);
const DARK = ruleBody(/^\.dark \.nx-builder-tokens,/m);
const CONSTANTS = ruleBody(
  /^\.nx-builder-tokens,\s*\.nx-builder-chrome,\s*\.nx-canvas-layer\s*\{/m
);

type Theme = "light" | "dark";

/** A token's value in a theme: the dark rule's where it declares one. */
function lookup(name: string, theme: Theme): string {
  const value =
    (theme === "dark" ? declared(DARK, name) : undefined) ??
    declared(LIGHT, name) ??
    declared(CONSTANTS, name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

/** A token resolved through `var()` to the literal `#rrggbb` it ends in. */
function hexOf(name: string, theme: Theme): string {
  const value = lookup(name, theme);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference !== null) return hexOf(reference[1] ?? "", theme);
  expect(value, `${name} (${theme})`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
}

/** A `#rrggbb` value's relative luminance, per WCAG 2.2. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(at => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe("the bar over a region edited in place", () => {
  it.each(["light", "dark"] as const)(
    "reads its words on its ground at AA in the %s theme",
    theme => {
      const ground = hexOf("--nx-builder-region-bar", theme);
      const words = hexOf("--nx-builder-region-bar-text", theme);
      expect(contrast(words, ground)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it("takes a value of its own in each theme", () => {
    expect(hexOf("--nx-builder-region-bar", "light")).not.toBe(
      hexOf("--nx-builder-region-bar", "dark")
    );
    expect(hexOf("--nx-builder-region-bar-text", "light")).not.toBe(
      hexOf("--nx-builder-region-bar-text", "dark")
    );
  });

  it("draws the bar and its Done in those tokens, Done the other way round", () => {
    const bar = ruleBody(/^\.nx-region-bar\s*\{/m);
    expect(bar).toMatch(/background:\s*var\(--nx-builder-region-bar\)/);
    expect(bar).toMatch(/color:\s*var\(--nx-builder-region-bar-text\)/);
    // The same pair swapped, so Done reads at the bar's own ratio.
    const done = ruleBody(/^\.nx-region-bar__done\s*\{/m);
    expect(done).toMatch(/background:\s*var\(--nx-builder-region-bar-text\)/);
    expect(done).toMatch(/color:\s*var\(--nx-builder-region-bar\)/);
  });
});

describe("the dim over the rest of the page", () => {
  it("is the editor's well made see-through, from tokens, in both themes", () => {
    // Declared once, over the well, which each theme sets: the light well in
    // light and the dark one in dark.
    expect(lookup("--nx-builder-region-dim", "light")).toMatch(
      /^color-mix\(\s*in oklch, var\(--nx-builder-well\) \d+%, transparent\s*\)$/
    );
    expect(declared(DARK, "--nx-builder-well")).toBeDefined();
    expect(declared(LIGHT, "--nx-builder-well")).toBeDefined();
  });

  it("is drawn by the chrome over the page, never by a rule on the page", () => {
    const dim = ruleBody(/^\.nx-region-scrim__dim\s*\{/m);
    expect(dim).toMatch(/background:\s*var\(--nx-builder-region-dim\)/);
    // No filter or opacity on anything of the page's: the page keeps its own
    // colours, under a scrim.
    expect(CHROME).not.toMatch(
      /nx-canvas-page-part[^{]*\{[^}]*(opacity|filter)/
    );
  });
});
