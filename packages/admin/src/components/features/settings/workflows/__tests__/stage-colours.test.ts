/**
 * Each swatch of the stage palette, as theme.css draws it in light AND dark:
 * the stage's label on the swatch reads at WCAG's 4.5:1, and the swatch's dot
 * stands out from the card at the 3:1 a graphical object needs. The neutral
 * "No colour" swatch is held to the same.
 *
 * Measured from the tokens' values in theme.css, not from the class names, so
 * a theme change that drops a swatch below the line fails here. The plausible
 * broken palette: a tone chosen for its light value whose dark label vanishes,
 * or a swatch whose classes name a token theme.css does not define.
 */
import { readFileSync } from "node:fs";

import { oklchToRgb, type Rgb } from "@nextlyhq/ui/color";
import { describe, expect, it } from "vitest";

import {
  NEUTRAL_SWATCH,
  STAGE_SWATCHES,
  stageColourOf,
} from "../stage-colours";

const theme = readFileSync(
  new URL("../../../../../../../ui/src/styles/theme.css", import.meta.url),
  "utf8"
);
const light = theme.slice(theme.indexOf(":root {"), theme.indexOf(".dark {"));
const dark = theme.slice(theme.indexOf(".dark {"));

/** A token's colour in one mode, read from its own block of theme.css. */
function tokenIn(block: string, token: string): Rgb {
  const match = new RegExp(
    `--nx-${token}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`
  ).exec(block);
  if (!match) throw new Error(`--nx-${token} has no oklch value here`);
  return oklchToRgb({
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
  });
}

/** WCAG 2.x contrast, written out here so the test does not grade itself with the code's own. */
function contrast(a: Rgb, b: Rgb): number {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lum = ({ r, g, b: blue }: Rgb) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The token a utility class paints with: `bg-info-surface` → `info-surface`. */
const tokenOf = (classes: string, prefix: "bg" | "text"): string => {
  const found = classes
    .split(" ")
    .find(each => each.startsWith(`${prefix}-`) && each !== "bg-transparent");
  if (!found) throw new Error(`no ${prefix}- class in "${classes}"`);
  return found.slice(prefix.length + 1);
};

const SWATCHES = [
  ...STAGE_SWATCHES.map(swatch => ({ ...swatch, solidDot: true })),
  { ...NEUTRAL_SWATCH, id: "none", solidDot: false },
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("the stage palette in %s", (_mode, block) => {
  it.each(SWATCHES)("$name: its label reads on it at 4.5:1", swatch => {
    const surface = tokenIn(block, tokenOf(swatch.surface, "bg"));
    const label = tokenIn(block, tokenOf(swatch.label, "text"));
    expect(contrast(label, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SWATCHES.filter(swatch => swatch.solidDot))(
    "$name: its dot stands out from the card at 3:1",
    swatch => {
      const dot = tokenIn(block, tokenOf(swatch.dot, "bg"));
      expect(contrast(dot, tokenIn(block, "card"))).toBeGreaterThanOrEqual(3);
    }
  );
});

describe("a stored colour", () => {
  it("is the palette swatch it names, whatever its case", () => {
    expect(stageColourOf("#2563EB")).toMatchObject({
      kind: "swatch",
      swatch: { name: "Blue" },
    });
  });

  it("is no colour when none is stored, and its own value outside the palette", () => {
    expect(stageColourOf(undefined)).toEqual({ kind: "none" });
    expect(stageColourOf("#123456")).toEqual({
      kind: "custom",
      value: "#123456",
    });
  });
});
