import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

/**
 * The editor's panels and the canvas well must look apart in both themes:
 * the panels (rail, side panels, top bar, menus) on one surface, the page on
 * a grey well a visible step darker. Both are mixed from the design system's
 * tokens, so whether they differ is a property of two stylesheets together:
 * the editor's (which says how each is mixed) and `@nextlyhq/ui`'s theme
 * (which says what each token it names is, in light and dark).
 *
 * jsdom computes no colours, so this reads both sheets, resolves each of the
 * editor's tokens down to an OKLCH lightness the way the browser would, and
 * holds the gap between panel and well to at least 0.03 in each theme. A
 * theme change that pulls the two together (the admin's dark ground is pure
 * black, so "a step darker than the background" cannot exist) fails here.
 *
 * The same resolver holds a picture's frame (a saved section's, a set's) to
 * WCAG's 3:1 for its edge against the panel and its icon against its ground,
 * in both themes, and keeps the editor's tokens off the page drawn inside.
 *
 * @module chrome-panel-tokens.test
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

/** The token block every builder scope shares, and its dark picks. */
const BUILDER_LIGHT = declarations(
  ruleBody(CHROME, /^\.nx-builder-tokens,\s*\.nx-builder-chrome,\s*:where\(/m)
);
const BUILDER_DARK = declarations(
  ruleBody(
    CHROME,
    /^\.dark \.nx-builder-tokens,\s*\.dark \.nx-builder-chrome,/m
  )
);

/** The design system's tokens in each theme: `:root`, and `.dark` over it. */
const THEME_LIGHT = declarations(ruleBody(THEME, /^:root\s*\{/m));
const THEME_DARK = new Map([
  ...THEME_LIGHT,
  ...declarations(ruleBody(THEME, /^\.dark\s*\{/m)),
]);

type Theme = "light" | "dark";

/** A token's value in a theme: the editor's own first, then the theme's. */
function lookup(name: string, theme: Theme): string {
  const builder =
    theme === "dark"
      ? (BUILDER_DARK.get(name) ?? BUILDER_LIGHT.get(name))
      : BUILDER_LIGHT.get(name);
  const value =
    builder ?? (theme === "dark" ? THEME_DARK : THEME_LIGHT).get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

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

/**
 * A colour's OKLCH lightness, resolved through `var()` and `color-mix(in
 * oklch, …)` as the browser resolves them. Mixing in OKLCH interpolates the
 * lightness channel linearly by the two weights, and the palette is neutral,
 * so the lightness alone decides the gap.
 */
function lightness(value: string, theme: Theme): number {
  const text = value.trim();
  const reference = /^var\((--[\w-]+)\)$/.exec(text);
  if (reference !== null) {
    return lightness(lookup(reference[1] ?? "", theme), theme);
  }
  const oklch = /^oklch\(\s*([\d.]+)(%?)/.exec(text);
  if (oklch !== null) {
    const amount = Number(oklch[1]);
    return oklch[2] === "%" ? amount / 100 : amount;
  }
  const mix = /^color-mix\(([\s\S]*)\)$/.exec(text);
  if (mix === null) throw new Error(`cannot resolve ${text}`);
  const [space, ...colours] = splitArguments(mix[1] ?? "");
  if (space !== "in oklch") throw new Error(`a mix not in oklch: ${text}`);
  const stops = colours.map(stop => {
    const weight = /\s([\d.]+)%$/.exec(stop);
    return {
      colour: weight === null ? stop : stop.slice(0, weight.index),
      weight: weight === null ? null : Number(weight[1]) / 100,
    };
  });
  const [first, second] = stops;
  if (first === undefined || second === undefined) {
    throw new Error(`a mix of fewer than two colours: ${text}`);
  }
  const a = first.weight ?? 1 - (second.weight ?? 0.5);
  const b = second.weight ?? 1 - a;
  return (
    (a * lightness(first.colour, theme) + b * lightness(second.colour, theme)) /
    (a + b)
  );
}

/** A literal colour: a hex, a colour function, or a named colour. */
const LITERAL_COLOUR =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:black|white|gr[ae]y|transparent)\b/i;

describe("the panel and well surfaces", () => {
  it.each(["light", "dark"] as const)(
    "keeps the well at least 0.03 darker than the panels in the %s theme",
    theme => {
      const panel = lightness("var(--nx-builder-panel)", theme);
      const well = lightness("var(--nx-builder-well)", theme);
      expect(panel - well).toBeGreaterThanOrEqual(0.03);
    }
  );

  it("draws the panels white in the light theme and above black in the dark", () => {
    // White panels around a grey well; in dark, panels a step above the
    // admin's black ground, so a well can sit a step below them.
    expect(lightness("var(--nx-builder-panel)", "light")).toBeGreaterThan(0.98);
    expect(lightness("var(--nx-builder-panel)", "dark")).toBeGreaterThan(0.1);
  });

  it("puts the editor's own surface and every popover on the panel", () => {
    // Menus and popovers the editor opens through the design system paint
    // `--nx-popover`; the panel is that token, so they share it by
    // construction rather than by a value that happens to match.
    expect(lookup("--nx-builder-panel", "light")).toBe("var(--nx-popover)");
    expect(lookup("--nx-builder-panel", "dark")).toBe("var(--nx-popover)");
    expect(lookup("--nx-builder-surface", "light")).toBe(
      "var(--nx-builder-panel)"
    );
  });

  it("states no literal colour in the panel, well and divider tokens", () => {
    for (const name of [
      "--nx-builder-panel",
      "--nx-builder-well",
      "--nx-builder-surface",
      "--nx-builder-divider",
      "--nx-builder-frame-edge",
    ]) {
      for (const theme of ["light", "dark"] as const) {
        expect(lookup(name, theme), `${name} (${theme})`).not.toMatch(
          LITERAL_COLOUR
        );
      }
    }
  });

  it("draws whatever the editor opens over itself on the panel too", () => {
    // A card, a notice or a tag the editor raises is one of its panels; the
    // dark `--nx-background` it used before is pure black, a hole in both.
    expect(lookup("--nx-builder-surface-raised", "light")).toBe(
      "var(--nx-builder-panel)"
    );
    expect(lookup("--nx-builder-surface-raised", "dark")).toBe(
      "var(--nx-builder-panel)"
    );
  });

  it("paints the whole canvas column with the well, strip and all", () => {
    // The strip a template draws above the page sits in the column too; left
    // unpainted, it showed the panel as a white band above the grey.
    const body = ruleBody(
      CHROME,
      /^\.nx-canvas-strip-slot,\s*\.nx-canvas-scroller\s*\{/m
    );
    expect(body).toMatch(/background-color:\s*var\(--nx-builder-well\)/);
  });

  it("draws the page frame's edge in the frame-edge token", () => {
    const body = ruleBody(CHROME, /^\.nx-canvas-frame\s*\{/m);
    expect(body).toMatch(/outline:\s*1px solid var\(--nx-builder-frame-edge\)/);
  });

  it("draws the dividers and the frame edge in the border token", () => {
    // So the more-contrast override of the border moves them with it.
    expect(lookup("--nx-builder-divider", "light")).toBe(
      "var(--nx-builder-border)"
    );
    expect(lookup("--nx-builder-frame-edge", "light")).toBe(
      "var(--nx-builder-border)"
    );
  });
});

/**
 * The literal colours a value ends in, through `var()` and `color-mix()`:
 * what has to be grey for its lightness alone to decide its luminance.
 */
function leafColours(value: string, theme: Theme): string[] {
  const text = value.trim();
  const reference = /^var\((--[\w-]+)\)$/.exec(text);
  if (reference !== null) {
    return leafColours(lookup(reference[1] ?? "", theme), theme);
  }
  const mix = /^color-mix\(([\s\S]*)\)$/.exec(text);
  if (mix === null) return [text];
  const [, ...colours] = splitArguments(mix[1] ?? "");
  return colours.flatMap(stop =>
    leafColours(stop.replace(/\s[\d.]+%$/, ""), theme)
  );
}

/**
 * The WCAG contrast ratio of two grey tokens. A grey's OKLCH lightness L is
 * the cube root of its relative luminance (with no chroma, OKLab's three
 * cone responses are all L³, and so is each linear sRGB channel), so the
 * ratio follows from the lightness the resolver above already finds.
 */
function contrast(a: string, b: string, theme: Theme): number {
  const [light, dark] = [lightness(a, theme), lightness(b, theme)]
    .map(l => l ** 3)
    .sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** A grey in OKLCH: no chroma. */
const ACHROMATIC = /^oklch\(\s*[\d.]+%?\s+0(?:\.0+)?\s/;

const PICTURE_TOKENS = [
  "--nx-builder-picture-edge",
  "--nx-builder-picture-ground",
  "--nx-builder-picture-icon",
] as const;

describe("a picture's frame", () => {
  it.each(["light", "dark"] as const)(
    "holds its edge to 3:1 against the panel in the %s theme",
    theme => {
      expect(
        contrast(
          "var(--nx-builder-picture-edge)",
          "var(--nx-builder-panel)",
          theme
        )
      ).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(["light", "dark"] as const)(
    "holds the icon to 3:1 on the ground it sits on in the %s theme",
    theme => {
      expect(
        contrast(
          "var(--nx-builder-picture-icon)",
          "var(--nx-builder-picture-ground)",
          theme
        )
      ).toBeGreaterThanOrEqual(3);
    }
  );

  it("mixes every picture token from the admin's greys, never a literal", () => {
    // Literal-free, so the dark theme follows through the admin's tokens; all
    // grey, so the ratios above are the luminances the browser draws.
    for (const name of PICTURE_TOKENS) {
      for (const theme of ["light", "dark"] as const) {
        expect(lookup(name, theme), `${name} (${theme})`).not.toMatch(
          LITERAL_COLOUR
        );
        for (const leaf of leafColours(`var(${name})`, theme)) {
          expect(leaf, `${name} (${theme})`).toMatch(ACHROMATIC);
        }
      }
    }
  });

  it("draws the frame in the picture tokens, and the page in none of the editor's", () => {
    const frame = ruleBody(CHROME, /^\.nx-picture\s*\{/m);
    expect(frame).toMatch(
      /border:\s*1px solid var\(--nx-builder-picture-edge\)/
    );
    expect(frame).toMatch(/background:\s*var\(--nx-builder-picture-ground\)/);
    expect(frame).toMatch(/color:\s*var\(--nx-builder-picture-icon\)/);
    // The drawn page keeps the site's own colours: nothing the editor's
    // tokens say reaches it, only the system colours of its scheme.
    for (const prelude of [
      /^\.nx-picture\[data-drawn="true"\]\s*\{/m,
      /^\.nx-picture__page\s*\{/m,
    ]) {
      // The site's own surface values, named as the canvas names them, are
      // the only custom properties it reads.
      expect(
        ruleBody(CHROME, prelude).replace(/var\(--nx-canvas-site-[a-z]+/g, "")
      ).not.toMatch(/var\(--nx-/);
    }
  });

  it("draws the page in the site's own body font and ink, as the canvas does", () => {
    const page = ruleBody(CHROME, /^\.nx-picture__page\s*\{/m);
    expect(page).toMatch(/color:\s*var\(--nx-canvas-site-ink,\s*CanvasText\)/);
    expect(page).toMatch(
      /font-family:\s*var\(--nx-canvas-site-font,\s*system-ui\),\s*sans-serif/
    );
  });

  it("starts the drawn page from a plain page's text, not the tile's it sits in", () => {
    // The tile centres its label in small type; the canvas's frame starts from
    // a document's defaults, so the picture's page has to as well, or a
    // left-aligned heading draws centred and unsized text draws small.
    const page = ruleBody(CHROME, /^\.nx-picture__page\s*\{/m);
    for (const reset of [
      /text-align:\s*start/,
      /font-size:\s*medium/,
      /font-weight:\s*normal/,
      /font-style:\s*normal/,
      /line-height:\s*normal/,
      /letter-spacing:\s*normal/,
      /text-transform:\s*none/,
      /white-space:\s*normal/,
    ]) {
      expect(page).toMatch(reset);
    }
  });
});
