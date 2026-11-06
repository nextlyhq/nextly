/**
 * The environment badge's contrast in each tone and mode (dashboard-experience R-23): its label at
 * least 4.5:1 on its fill, and its edge at least 3:1 against the page it sits on.
 *
 * Measured from what is drawn: the badge is rendered, the colour utilities its final class list
 * holds are read for each mode (a `dark:` utility in place of its plain one in dark mode), and each
 * is resolved through `theme.css` as the admin's stylesheet resolves it, `color-mix()` shades
 * included. So a tone whose classes change, or a theme token that moves, is judged again, and the
 * test cannot pass on a table of colours of its own.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { oklchToRgb, type Rgb } from "@nextlyhq/ui/color";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EnvironmentBadge } from "./EnvironmentBadge";

// From the module's own path as a string: the DOM environment replaces the global `URL`, whose
// objects `readFileSync` does not take.
const THEME = readFileSync(
  resolvePath(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../ui/src/styles/theme.css"
  ),
  "utf8"
);

/** The custom properties a block of `theme.css` declares, from its opening line to its close. */
function declarations(opening: string): Map<string, string> {
  const start = THEME.indexOf(`\n${opening} {`);
  if (start === -1) throw new Error(`theme.css has no ${opening} block`);
  const end = THEME.indexOf("\n}", start);
  const body = THEME.slice(start, end);
  return new Map(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [
      m[1]!,
      m[2]!.trim(),
    ])
  );
}

/** The `--color-*` utilities, and each mode's `--nx-*` tokens, dark laid over light. */
const SCALE = declarations("@theme inline");
const LIGHT = declarations(":root");
const MODES = {
  light: LIGHT,
  dark: new Map([...LIGHT, ...declarations(".dark")]),
} as const;
type Mode = keyof typeof MODES;

/** WCAG 2.x contrast, written out here so the test does not grade itself with the code's own. */
function contrast(a: Rgb, b: Rgb): number {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lum = ({ r, g, b: blue }: Rgb) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * A colour expression of the theme, resolved to sRGB for one mode: an `oklch()` literal, `white`
 * or `black`, a `var()` of a token or a utility, or a `color-mix(in srgb, ...)` of two of them.
 */
function resolve(expression: string, mode: Mode): Rgb {
  const value = expression.trim();
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (ref) {
    const next = MODES[mode].get(ref[1]!) ?? SCALE.get(ref[1]!);
    if (next === undefined) throw new Error(`theme.css never sets ${ref[1]}`);
    return resolve(next, mode);
  }
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (oklch) {
    return oklchToRgb({ l: +oklch[1]!, c: +oklch[2]!, h: +oklch[3]! });
  }
  if (value === "white") return { r: 1, g: 1, b: 1 };
  if (value === "black") return { r: 0, g: 0, b: 0 };
  const mix = /^color-mix\(in srgb, (.+), (\S+) (\d+)%\)$/.exec(value);
  if (mix) {
    const [a, b, weight] = [
      resolve(mix[1]!, mode),
      resolve(mix[2]!, mode),
      Number(mix[3]) / 100,
    ];
    const at = (x: number, y: number) => x * (1 - weight) + y * weight;
    return { r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b) };
  }
  throw new Error(`cannot resolve ${value}`);
}

/** The colour utility of one kind the badge's classes set in a mode, or none. */
function utility(
  classes: readonly string[],
  kind: "text" | "bg" | "border",
  mode: Mode
): string | undefined {
  const colours = (prefix: string) =>
    classes
      .filter(name => name.startsWith(`${prefix}${kind}-`))
      .map(name => name.slice(prefix.length + kind.length + 1))
      // A colour, not a width or a size: one the theme defines, or the special keywords.
      .filter(
        name =>
          SCALE.has(`--color-${name}`) ||
          ["current", "transparent"].includes(name)
      );
  const plain = colours("");
  const dark = colours("dark:");
  // Two utilities of one kind for one mode leave the colour to stylesheet order: no answer.
  expect(plain.length, `${kind} colours: ${plain.join(", ")}`).toBeLessThan(2);
  expect(dark.length, `dark ${kind} colours: ${dark.join(", ")}`).toBeLessThan(
    2
  );
  return mode === "dark" ? (dark[0] ?? plain[0]) : plain[0];
}

/** The badge as drawn in one mode: its label's colour, its fill, and its edge. */
function drawn(classes: readonly string[], mode: Mode) {
  const page = resolve("var(--nx-background)", mode);
  const colour = (name: string | undefined, fallback: Rgb): Rgb =>
    name === undefined || name === "transparent"
      ? fallback
      : resolve(`var(--color-${name})`, mode);
  const text = colour(
    utility(classes, "text", mode),
    resolve("var(--nx-foreground)", mode)
  );
  const fill = colour(utility(classes, "bg", mode), page);
  const border = utility(classes, "border", mode);
  // With a border, the edge is its colour (`current` the label's); without one, the fill's own.
  const hasBorder = classes.includes("border");
  const edge = !hasBorder
    ? fill
    : border === "current"
      ? text
      : colour(border, resolve("var(--nx-border)", mode));
  return { page, text, fill, edge };
}

const TONES = ["neutral", "warning", "critical"] as const;

describe("the environment badge's contrast", () => {
  for (const tone of TONES) {
    for (const mode of ["light", "dark"] as const) {
      it(`${tone}, ${mode}: the label 4.5:1 on its fill, the edge 3:1 on the page`, () => {
        render(<EnvironmentBadge environment={{ label: "Staging", tone }} />);
        const classes = screen
          .getByTestId("dashboard-environment")
          .className.split(/\s+/);
        const { page, text, fill, edge } = drawn(classes, mode);
        expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(edge, page)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("resolves the theme it measures with: the page and its text are far apart in each mode", () => {
    // The control: a resolver that answered one colour for everything would pass nothing above,
    // and one that answered black and white for everything would pass everything.
    for (const mode of ["light", "dark"] as const) {
      expect(
        contrast(
          resolve("var(--nx-foreground)", mode),
          resolve("var(--nx-background)", mode)
        )
      ).toBeGreaterThan(15);
      expect(
        contrast(
          resolve("var(--color-border)", mode),
          resolve("var(--nx-background)", mode)
        )
      ).toBeLessThan(1.5);
    }
  });
});
