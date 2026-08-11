/**
 * Two questions the miss count cannot answer, both measured rather than argued.
 *
 * 1. WHY are some themes' pairings clustered near the gate? The hypothesis
 *    worth testing is structural: a monochrome palette has one axis to spend,
 *    so every surface level, border and muted text is packed onto lightness
 *    alone, and pairings land near thresholds because there is nowhere else to
 *    put them. If that holds, thinness is a property of the DESIGN and has no
 *    nudge-sized fix -- widening it means either fewer surface levels or more
 *    lightness spread between them, and the tightness is what the monochrome
 *    aesthetic is buying. That is a founder tradeoff, not a mechanical fix.
 *
 * 2. Whether the "fragile" band should be 0.25. That was a guess; the
 *    empirical answer is how far the ruler actually moves when it moves.
 *
 * Run: pnpm theme:margins  (tsx scripts/audit-margins.mjs)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { converter } from "culori";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "../../..");

const { NEXTLY_THEMES, TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/index.ts"
);
const { measureTheme } = await import("../src/theme-lab/validate-contrast.ts");

const css = readFileSync(
  resolvePath(root, "packages/ui/src/styles/theme.css"),
  "utf8"
);

const toOklch = converter("oklch");

/**
 * A token's colour in OKLCH, whatever notation it was written in.
 *
 * Matching `oklch(` textually measured the Nextly themes and quietly skipped
 * the imported presets, whose surfaces, foregrounds and accents are hex. The
 * structural figures below then described each preset's handful of inherited
 * status and syntax tokens rather than its palette, and reported that as the
 * palette's shape.
 *
 * Returns null for a value this cannot resolve on its own -- a `var()`
 * reference or a `color-mix()` -- which the caller counts rather than absorbs.
 */
function oklchOf(value) {
  if (/^(var\(|color-mix\()/.test(value.trim())) return null;
  try {
    return toOklch(value.trim()) ?? null;
  } catch {
    return null;
  }
}

/** Values a palette cannot be measured from, reported rather than dropped. */
function unreadable(tokens) {
  return Object.values(tokens).filter(value => oklchOf(value) === null).length;
}

/** The lightness of every literal colour token, deduped. */
function lightnessSteps(tokens) {
  const steps = new Set();
  for (const value of Object.values(tokens)) {
    const color = oklchOf(value);
    // Rounded: two authored values a thousandth apart are one step to the eye,
    // and hex converts to long decimals that would each count separately.
    if (color) steps.add(Number(color.l.toFixed(3)));
  }
  return [...steps].sort((a, b) => a - b);
}

/** How much chroma a palette actually spends: distinct non-trivial chromas. */
function chromaSpend(tokens) {
  const cs = new Set();
  for (const value of Object.values(tokens)) {
    const color = oklchOf(value);
    if (color && (color.c ?? 0) > 0.005) cs.add(Number(color.c.toFixed(3)));
  }
  return cs.size;
}

console.log(
  "theme".padEnd(24) +
    "near-gate".padStart(10) +
    "L-steps".padStart(9) +
    "L-range".padStart(9) +
    "steps/range".padStart(13) +
    "chromas".padStart(9) +
    // Printed rather than assumed to be zero: a token this cannot resolve is a
    // token the figures on its row do not describe, and a silent skip is what
    // made every preset's palette look like the handful of values that
    // happened to be readable.
    "unread".padStart(8)
);

// One row per MODE, not per theme.
//
// A single row counted near-gate pairings across both modes while every
// structural column beside it described `theme.light` alone. A theme whose
// fragile pairings all came from dark mode therefore had them attributed to a
// light palette that did not produce them, and its dark palette's structure --
// the thing that would explain them -- appeared nowhere. The table's whole
// purpose is relating margin pressure to palette structure, and that pairing
// was wrong for exactly the rows worth reading.
for (const theme of [...NEXTLY_THEMES, ...TWEAKCN_THEMES]) {
  const rs = measureTheme(theme, css);
  for (const mode of ["light", "dark"]) {
    const nearGate = rs.filter(
      r => r.mode === mode && r.margin >= 0 && r.margin < 0.25
    ).length;
    const tokens = theme[mode];
    const steps = lightnessSteps(tokens);
    const range = steps.length > 1 ? steps[steps.length - 1] - steps[0] : 0;
    const density = range > 0 ? steps.length / range : 0;
    console.log(
      `${theme.id}/${mode}`.padEnd(24) +
        String(nearGate).padStart(10) +
        String(steps.length).padStart(9) +
        range.toFixed(3).padStart(9) +
        density.toFixed(1).padStart(13) +
        String(chromaSpend(tokens)).padStart(9) +
        String(unreadable(tokens)).padStart(8)
    );
  }
}
