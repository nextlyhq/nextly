import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contrastRatio, type Rgb } from "@nextlyhq/blocks-engine";
import { oklchToRgb } from "@nextlyhq/ui/color";
import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

/**
 * The editor's words in the destructive red read as small text: a value a
 * field refused, a reason a choice cannot be made, a filter that names a
 * field the list no longer has. AA asks 4.5:1 of them on the panel they sit
 * on, in light and dark.
 *
 * The admin's `--nx-destructive` is the red of a fill and a border. As words
 * on the light panel it reads 3.73:1. The editor's `--nx-builder-destructive-
 * text` is that red made to read as words: deepened in the light theme, the
 * solid red in the dark. So no rule draws its words in the bare token, and
 * the one they draw in is measured here on the panel and the page ground, in
 * both themes.
 *
 * jsdom computes no stylesheet, so this reads the editor's sheet and the
 * design system's theme and resolves each token as the browser would.
 *
 * @module styles/destructive-text-colour.test
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

const CHROME = stripComments(
  chromeStylesheetSource(url => readFileSync(fileURLToPath(url), "utf8"))
);

const THEME = stripComments(
  readFileSync(join(HERE, "../../../ui/src/styles/theme.css"), "utf8")
);

/** The body of the first rule whose prelude matches `prelude`. */
function ruleBody(sheet: string, prelude: RegExp): string {
  const match = prelude.exec(sheet);
  if (match === null) throw new Error(`no rule matching ${prelude}`);
  const open = sheet.indexOf("{", match.index);
  let depth = 1;
  let close = open + 1;
  for (; close < sheet.length && depth > 0; close += 1) {
    if (sheet[close] === "{") depth += 1;
    else if (sheet[close] === "}") depth -= 1;
  }
  return sheet.slice(open + 1, close - 1);
}

/** The custom properties a rule body declares, by name. */
function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim());
  }
  return found;
}

type Theme = "light" | "dark";

/** Each theme's tokens: the design system's, with the editor's over them. */
const THEME_LIGHT = declarations(ruleBody(THEME, /^:root\s*\{/m));
const TOKENS: Record<Theme, Map<string, string>> = {
  light: new Map([
    ...THEME_LIGHT,
    ...declarations(
      ruleBody(
        CHROME,
        /^\.nx-builder-tokens,\s*\.nx-builder-chrome,\s*:where\(/m
      )
    ),
  ]),
  dark: new Map([
    ...THEME_LIGHT,
    ...declarations(ruleBody(THEME, /^\.dark\s*\{/m)),
    ...declarations(
      ruleBody(
        CHROME,
        /^\.nx-builder-tokens,\s*\.nx-builder-chrome,\s*:where\(/m
      )
    ),
    ...declarations(
      ruleBody(
        CHROME,
        /^\.dark \.nx-builder-tokens,\s*\.dark \.nx-builder-chrome,/m
      )
    ),
  ]),
};

/** The arguments of a function call, split at the top-level commas. */
function splitArguments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

/**
 * A colour in a theme, through `var()`, `oklch()` and `color-mix(in srgb,
 * …)`: the forms the destructive tokens and the surfaces are written in. Any
 * other form throws rather than being guessed at.
 */
function resolve(value: string, theme: Theme): Rgb {
  const text = value.trim();
  const reference = /^var\((--[\w-]+)\)$/.exec(text);
  if (reference !== null) {
    const name = reference[1] ?? "";
    const declared = TOKENS[theme].get(name);
    if (declared === undefined) throw new Error(`${name} is not declared`);
    return resolve(declared, theme);
  }
  const named = NAMED[text];
  if (named !== undefined) return named;
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(text);
  if (oklch !== null) {
    const { r, g, b } = oklchToRgb({
      l: Number(oklch[1]),
      c: Number(oklch[2]),
      h: Number(oklch[3]),
    });
    return { r: r * 255, g: g * 255, b: b * 255, a: 1 };
  }
  const mix = /^color-mix\(([\s\S]*)\)$/.exec(text);
  if (mix === null) throw new Error(`cannot resolve ${text}`);
  const [space, first, second] = splitArguments(mix[1] ?? "");
  if (space !== "in srgb" || first === undefined || second === undefined) {
    throw new Error(`a mix this cannot resolve: ${text}`);
  }
  const stop = (part: string): { colour: string; weight: number | null } => {
    const weight = /\s([\d.]+)%$/.exec(part);
    return weight === null
      ? { colour: part, weight: null }
      : {
          colour: part.slice(0, weight.index),
          weight: Number(weight[1]) / 100,
        };
  };
  const a = stop(first);
  const b = stop(second);
  const wa = a.weight ?? 1 - (b.weight ?? 0.5);
  const wb = b.weight ?? 1 - wa;
  const ca = resolve(a.colour, theme);
  const cb = resolve(b.colour, theme);
  const channel = (x: number, y: number): number =>
    (x * wa + y * wb) / (wa + wb);
  return {
    r: channel(ca.r, cb.r),
    g: channel(ca.g, cb.g),
    b: channel(ca.b, cb.b),
    a: 1,
  };
}

/** AA for small text. */
const SMALL_TEXT = 4.5;

/** The grounds the editor's words sit on: its panels, and the page's. */
const GROUNDS = ["var(--nx-builder-panel)", "var(--nx-background)"] as const;

/** The lowest ratio a colour reaches on those grounds, and where. */
function lowestContrast(colour: string): { ratio: number; where: string } {
  const measured = (["light", "dark"] as const).flatMap(theme =>
    GROUNDS.map(ground => ({
      ratio: contrastRatio(resolve(colour, theme), resolve(ground, theme)),
      where: `${ground} in ${theme}`,
    }))
  );
  measured.sort((x, y) => x.ratio - y.ratio);
  const [lowest] = measured;
  if (lowest === undefined) throw new Error("nothing measured");
  return lowest;
}

/** Each rule that draws its words in the bare destructive token. */
function rulesInBareDestructive(): string[] {
  const found: string[] = [];
  for (const [, prelude, body] of CHROME.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/(?:^|[;\s])color\s*:\s*var\(--nx-destructive\)\s*;/.test(body ?? "")) {
      found.push((prelude ?? "").trim().replace(/\s+/g, " "));
    }
  }
  return found;
}

describe("the editor's words in the destructive red", () => {
  it("are never drawn in the bare destructive token", () => {
    expect(rulesInBareDestructive()).toEqual([]);
  });

  it("draw the inspector's problem line in the destructive text token", () => {
    expect(ruleBody(CHROME, /^\.nx-inspector__problem\s*\{/m)).toMatch(
      /(?:^|[;\s])color:\s*var\(--nx-builder-destructive-text\);/
    );
  });

  it("read 4.5:1 on the panel and the page in light and dark", () => {
    const { ratio, where } = lowestContrast(
      "var(--nx-builder-destructive-text)"
    );
    expect(ratio, `${ratio.toFixed(2)}:1 on ${where}`).toBeGreaterThanOrEqual(
      SMALL_TEXT
    );
  });

  it("would not read in the bare token, so the measure can tell", () => {
    // The control: the same measure fails the token the words left.
    const { ratio } = lowestContrast("var(--nx-destructive)");
    expect(ratio).toBeLessThan(SMALL_TEXT);
  });
});
