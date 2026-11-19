/**
 * The SEO import page's "choose it", the words that offer the file browser
 * inside the drop area, read under any brand: they reach AA's 4.5:1 for small
 * text on every surface they sit on, in light and dark, and they are
 * underlined at rest, so they read as a link without relying on colour.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour. The words
 * were drawn in it, and under the e2e suite's indigo `#6366f1` that is
 * 4.35:1 on the light page, under the 4.5:1 axe's `color-contrast` asks. They
 * take the text colour instead, as the admin's own small links do.
 *
 * jsdom computes no stylesheet, so the colour a class paints is resolved from
 * the theme file, with the brand declared the way the admin's server
 * stylesheet declares it. Every element in the page's source that is drawn as
 * a link (underlined at rest, or in the brand's colour) is read.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBrandingCss } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  compositeOver,
  contrastRatio,
} from "../../../../ui/src/styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../../../../ui/src/styles/contrast/parse-theme";
import {
  resolveColor,
  type ResolveContext,
} from "../../../../ui/src/styles/contrast/resolve";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(
  resolve(here, "../../../../ui/src/styles/theme.css"),
  "utf8"
);
const theme = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);

/** The e2e suite's brand: too light for small text on a light surface. */
const INDIGO = "#6366f1";

/** The declarations the admin's server stylesheet writes for the brand. */
const brandTokens: TokenMap = new Map(
  [
    ...(getBrandingCss({ colors: { primary: INDIGO } }) ?? "").matchAll(
      /(--nx-[\w-]+)\s*:\s*([^;]+);/g
    ),
  ].map(([, name, value]) => [name ?? "", (value ?? "").trim()])
);

const MODES: Record<"light" | "dark", ResolveContext> = {
  light: { tokens: new Map([...theme.light, ...brandTokens]), scale },
  dark: { tokens: new Map([...theme.dark, ...brandTokens]), scale },
};

/** The surfaces these links sit on: the page, a card and a dialog. */
const SURFACES = ["background", "card", "popover"] as const;

/** AA for small text. */
const SMALL_TEXT = 4.5;

/** The class names that apply at rest, without a state or breakpoint. */
function restingClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .filter(name => name !== "" && !name.includes(":"));
}

/** The theme colour token the words' `text-*` class paints. */
function wordsToken(classes: string[]): string {
  for (const name of classes) {
    const token = /^text-([a-z-]+)$/.exec(name)?.[1];
    if (token && scale.has(`--color-${token}`)) return token;
  }
  throw new Error(`no theme text colour in "${classes.join(" ")}"`);
}

/** The lowest ratio the words reach, and where. */
function lowestContrast(classes: string[]): { ratio: number; where: string } {
  const token = wordsToken(classes);
  const measured = Object.entries(MODES).flatMap(([mode, ctx]) =>
    SURFACES.map(surface => {
      const ground = resolveColor(`var(--color-${surface})`, ctx);
      const ink = compositeOver(
        resolveColor(`var(--color-${token})`, ctx),
        ground
      );
      return { ratio: contrastRatio(ink, ground), where: `${mode} ${surface}` };
    })
  );
  measured.sort((a, b) => a.ratio - b.ratio);
  const [lowest] = measured;
  if (!lowest) throw new Error("nothing measured");
  return lowest;
}

function expectReadableLink(className: string, what: string): void {
  const classes = restingClasses(className);
  const { ratio, where } = lowestContrast(classes);
  expect(
    ratio,
    `${what} in text-${wordsToken(classes)} reads ${ratio.toFixed(2)}:1 on ${where}`
  ).toBeGreaterThanOrEqual(SMALL_TEXT);
  // Told from the words around it by more than colour.
  expect(classes, `${what} is not underlined at rest`).toContain("underline");
}

/**
 * Each element in a source file drawn as a link: its literal class list
 * underlines it at rest, or paints its words in the brand's colour.
 */
function linkStyledIn(source: string): { className: string; at: string }[] {
  return [...source.matchAll(/<[A-Za-z]+\s(?:[^<>]|=>)*?className="([^"]*)"/g)]
    .map(match => ({
      className: match[1] ?? "",
      at: `line ${source.slice(0, match.index).split("\n").length}`,
    }))
    .filter(({ className }) => {
      const resting = restingClasses(className);
      return resting.includes("underline") || resting.includes("text-primary");
    });
}

describe("the SEO import page's link words", () => {
  it("read under an indigo brand", () => {
    const source = readFileSync(resolve(here, "../SeoImportPage.tsx"), "utf8");
    const links = linkStyledIn(source);
    // The drop area's "choose it", and nothing else drawn as a link.
    expect(links).toHaveLength(1);
    for (const { className, at } of links) {
      expectReadableLink(className, `the link words at ${at}`);
    }
  });
});
