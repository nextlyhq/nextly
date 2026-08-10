/**
 * Solves the minimal oklch lightness that clears a target contrast ratio
 * against a given background, hue and chroma held fixed.
 *
 * Binary search against the HARNESS's own resolve/contrast functions rather
 * than a closed-form luminance formula: the harness composites alpha and
 * evaluates `color-mix()` the same way the assertion does, so a value solved
 * here agrees with the test by construction instead of by coincidence.
 *
 * A scratch tool for the Calm rehabilitation, kept because the next theme
 * that needs retuning will want it too.
 */
import {
  contrastRatio,
  type Rgb,
} from "../../../packages/ui/src/styles/contrast/color";
import { resolveColor } from "../../../packages/ui/src/styles/contrast/resolve";

const ctx = {
  tokens: new Map<string, string>(),
  scale: new Map<string, string>(),
} as unknown as Parameters<typeof resolveColor>[1];

function px(value: string): Rgb {
  const c = resolveColor(value, ctx);
  if (!c) throw new Error(`unresolvable: ${value}`);
  return c;
}

function solve(
  chroma: number,
  hue: number,
  bg: Rgb,
  target: number,
  direction: "darker" | "lighter"
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const ok = contrastRatio(px(`oklch(${mid} ${chroma} ${hue})`), bg) >= target;
    if (direction === "darker") {
      if (ok) lo = mid;
      else hi = mid;
    } else if (ok) hi = mid;
    else lo = mid;
  }
  return direction === "darker" ? lo : hi;
}

const S = {
  lightPage: px("oklch(0.975 0.004 260)"),
  lightCard: px("oklch(1 0 0)"),
  lightMuted: px("oklch(0.97 0.003 260)"),
  white: px("oklch(1 0 0)"),
  darkPage: px("oklch(0.21 0.008 262)"),
  darkCard: px("oklch(0.27 0.009 262)"),
  darkPopover: px("oklch(0.29 0.01 262)"),
  darkMuted: px("oklch(0.31 0.01 262)"),
  darkFg: px("oklch(0.99 0.002 260)"),
};

// Each row solves against the STRICTEST surface the token appears on, so one
// value clears every pairing that token takes part in.
const rows: [string, number, number, Rgb, number, "darker" | "lighter"][] = [
  ["light muted-foreground", 0.012, 260, S.lightCard, 5.0, "darker"],
  ["light code-comment/punct", 0.01, 260, S.lightMuted, 5.0, "darker"],
  ["light destructive", 0.13, 22, S.lightCard, 5.0, "darker"],
  ["light success", 0.09, 155, S.lightCard, 5.0, "darker"],
  ["light warning", 0.1, 75, S.lightCard, 5.0, "darker"],
  ["light primary (white on it)", 0.06, 250, S.white, 5.0, "darker"],
  ["light input (3:1 on card)", 0.006, 260, S.lightCard, 3.4, "darker"],
  ["light sidebar-border", 0.005, 260, S.lightPage, 3.4, "darker"],
  ["dark muted-foreground", 0.012, 262, S.darkMuted, 5.0, "lighter"],
  ["dark destructive", 0.12, 22, S.darkMuted, 5.0, "lighter"],
  ["dark success", 0.09, 155, S.darkMuted, 5.0, "lighter"],
  ["dark primary (fg on it)", 0.07, 250, S.darkFg, 5.0, "darker"],
  ["dark input (3:1 on popover)", 0.012, 262, S.darkPopover, 3.4, "lighter"],
  ["dark sidebar-border", 0.01, 262, S.darkPage, 3.4, "lighter"],
];

for (const [label, c, h, bg, target, dir] of rows) {
  const solved = solve(c, h, bg, target, dir);
  const achieved = contrastRatio(px(`oklch(${solved} ${c} ${h})`), bg);
  console.log(
    `${label.padEnd(30)} L=${solved.toFixed(3)}  ->  ${achieved.toFixed(2)}:1`
  );
}
