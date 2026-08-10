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
 * Run: node scripts/audit-margins.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-extension-loader.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "../../..");

const { NEXTLY_THEMES } = await import("../src/theme-lab/themes/index.ts");
const { TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/tweakcn.generated.ts"
);
const { measureTheme } = await import("../src/theme-lab/validate-contrast.ts");

const css = readFileSync(
  resolvePath(root, "packages/ui/src/styles/theme.css"),
  "utf8"
);

/** The oklch lightness of every literal colour token, deduped. */
function lightnessSteps(tokens) {
  const steps = new Set();
  for (const value of Object.values(tokens)) {
    const m = /^oklch\(\s*([0-9.]+)/.exec(value);
    if (m) steps.add(Number(m[1]));
  }
  return [...steps].sort((a, b) => a - b);
}

/** How much chroma a palette actually spends: distinct non-trivial chromas. */
function chromaSpend(tokens) {
  const cs = new Set();
  for (const value of Object.values(tokens)) {
    const m = /^oklch\(\s*[0-9.]+\s+([0-9.]+)/.exec(value);
    if (m && Number(m[1]) > 0.005) cs.add(Number(m[1]));
  }
  return cs.size;
}

console.log(
  "theme".padEnd(24) +
    "near-gate".padStart(10) +
    "L-steps".padStart(9) +
    "L-range".padStart(9) +
    "steps/range".padStart(13) +
    "chromas".padStart(9)
);

for (const theme of [...NEXTLY_THEMES, ...TWEAKCN_THEMES]) {
  const rs = measureTheme(theme, css);
  const nearGate = rs.filter(r => r.margin >= 0 && r.margin < 0.25).length;
  const steps = lightnessSteps(theme.light);
  const range = steps.length > 1 ? steps[steps.length - 1] - steps[0] : 0;
  const density = range > 0 ? steps.length / range : 0;
  console.log(
    theme.id.padEnd(24) +
      String(nearGate).padStart(10) +
      String(steps.length).padStart(9) +
      range.toFixed(3).padStart(9) +
      density.toFixed(1).padStart(13) +
      String(chromaSpend(theme.light)).padStart(9)
  );
}
