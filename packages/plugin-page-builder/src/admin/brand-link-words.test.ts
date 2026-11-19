/**
 * The Page Builder's small links read under any brand: their words reach AA's
 * 4.5:1 for small text on every surface they sit on, in light and dark, and
 * they are underlined at rest, so they read as links without relying on
 * colour.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour. These links
 * drew their words in it, and under the e2e suite's indigo `#6366f1` that is
 * 4.35:1 on the light page and 4.22:1 on a dark popover, under the 4.5:1
 * axe's `color-contrast` asks. The words take the text colour instead, as the
 * admin's own small links do; the brand keeps the fills, borders and rings it
 * was made for.
 *
 * jsdom computes no stylesheet, so the colour a class paints is resolved from
 * the theme file, with the brand declared the way the admin's server
 * stylesheet declares it. These links sit in dialogs and panels reached only
 * after a server answers (the pages using a layout, the documents a removed
 * breakpoint could not be undone in), so every link in those files is read
 * from its source.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBrandingCss } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  compositeOver,
  contrastRatio,
} from "../../../ui/src/styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../../../ui/src/styles/contrast/parse-theme";
import {
  resolveColor,
  type ResolveContext,
} from "../../../ui/src/styles/contrast/resolve";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(
  resolve(here, "../../../ui/src/styles/theme.css"),
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

/** The links each file draws, and how many, so a missed one is noticed. */
const LINK_FILES: Record<string, number> = {
  "./RemoveLayoutAction.tsx": 1,
  "./RemoveLayoutMove.tsx": 1,
  "./DeleteComponentDialog.tsx": 1,
  "./TemplateDesignDetails.tsx": 1,
  "./editor/breakpoint-undo-step.tsx": 1,
};

/**
 * Each `<a>` in a source file, with its class list: a literal, or a template
 * whose `${…}` parts are left out (they add a face or a tone, not the words'
 * colour).
 */
function linksIn(source: string): { className: string; at: string }[] {
  return [
    ...source.matchAll(
      /<a\s(?:[^<>]|=>)*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g
    ),
  ].map(match => ({
    className: (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " "),
    at: `line ${source.slice(0, match.index).split("\n").length}`,
  }));
}

describe("the Page Builder's small links", () => {
  for (const [file, count] of Object.entries(LINK_FILES)) {
    it(`read under an indigo brand: ${file.replace("./", "")}`, () => {
      const source = readFileSync(resolve(here, file), "utf8");
      const links = linksIn(source);
      expect(links).toHaveLength(count);
      for (const { className, at } of links) {
        expectReadableLink(className, `the link at ${at}`);
      }
    });
  }
});
