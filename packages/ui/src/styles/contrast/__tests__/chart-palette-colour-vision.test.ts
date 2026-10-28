/**
 * Holds the five chart colours apart for every reader, in both modes, reading the real tokens
 * from `theme.css`: every pair at least 12 apart as drawn, and at least 8 apart as a reader with
 * protanopia, deuteranopia or tritanopia sees them. A chart of statuses tells its bars apart by
 * these colours as well as by their labels, so two slots that collapse into one colour for such a
 * reader would read as one status.
 *
 * Distances are in OKLab, scaled by 100, where about 2 is the smallest difference anyone notices
 * and 8 is told apart at a glance. Colour-vision deficiency is simulated with the matrices of
 * Machado, Oliveira and Fernandes (2009) at full severity, applied in linear sRGB. Contrast against
 * the surfaces a chart draws on is `token-contrast.test.ts`'s, not this file's.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { converter } from "culori";
import { describe, expect, it } from "vitest";

import { toClampedRgb, type Rgb } from "../color";
import { parseThemeTokens, resolveToken, type TokenMap } from "../parse-theme";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../theme.css"),
  "utf8"
);
const { light, dark } = parseThemeTokens(css);

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** How each deficiency maps linear sRGB, at full severity; `null` is the colour as drawn. */
const VISION: Readonly<Record<string, Matrix | null>> = {
  typical: null,
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** The least distance any pair may have, as drawn and as each deficiency sees it. */
const LEAST = { typical: 12, simulated: 8 };

const toLinear = converter("lrgb");
const toOklab = converter("oklab");
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** A drawn colour as a reader with `matrix`'s deficiency sees it, in OKLab. */
function seen(color: Rgb, matrix: Matrix | null) {
  const linear = toLinear({ mode: "rgb", r: color.r, g: color.g, b: color.b });
  const [r, g, b] = matrix
    ? matrix.map(row =>
        clamp01(row[0] * linear.r + row[1] * linear.g + row[2] * linear.b)
      )
    : [linear.r, linear.g, linear.b];
  return toOklab({ mode: "lrgb", r, g, b });
}

/** How far apart two drawn colours are for a reader with `matrix`'s deficiency. */
function apart(a: Rgb, b: Rgb, matrix: Matrix | null): number {
  const p = seen(a, matrix);
  const q = seen(b, matrix);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b) * 100;
}

/** Every pair of chart slots closer than its minimum, named with the distance. */
function tooClose(tokens: TokenMap): string[] {
  const slots = [1, 2, 3, 4, 5].map(n => ({
    n,
    color: toClampedRgb(resolveToken(tokens, `--nx-chart-${n}`)),
  }));
  const found: string[] = [];
  for (const [vision, matrix] of Object.entries(VISION)) {
    const least = matrix ? LEAST.simulated : LEAST.typical;
    slots.forEach((a, index) => {
      for (const b of slots.slice(index + 1)) {
        const distance = apart(a.color, b.color, matrix);
        if (distance < least) {
          found.push(
            `${vision}: chart ${a.n} and chart ${b.n} are ${distance.toFixed(1)} apart, under ${least}`
          );
        }
      }
    });
  }
  return found;
}

describe("the chart palette for every reader", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ])("keeps every pair of slots apart in %s mode", (_, tokens) => {
    expect(tooClose(tokens)).toEqual([]);
  });

  /*
   * The instrument, checked on a pair it must catch: a green and a red of one lightness and
   * chroma, far apart as drawn and nearly one colour to a reader with deuteranopia. Were the
   * matrices wrong or not applied, this pair would pass.
   */
  it("finds a green and a red of one lightness close for deuteranopia and far apart as drawn", () => {
    const green = toClampedRgb("oklch(0.6 0.15 145)");
    const red = toClampedRgb("oklch(0.6 0.15 30)");
    expect(apart(green, red, VISION.typical ?? null)).toBeGreaterThan(
      LEAST.typical
    );
    expect(apart(green, red, VISION.deuteranopia ?? null)).toBeLessThan(
      LEAST.simulated
    );
  });
});
