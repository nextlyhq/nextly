/**
 * Guards against faint Tailwind alpha-opacity color utilities (`text-primary/50`,
 * `border-primary/10`) creeping back into the admin. A token check cannot see
 * these because the opacity is applied per call site, not in the theme, so this
 * scans the source instead: it resolves each `text-<token>/NN` and
 * `border-<token>/NN` utility, composites it over the page surface, and fails
 * any that drop below WCAG unless the utility is in ALLOWED_DECORATIVE (below).
 *
 * Scope note: this reads sibling packages' source, so Turbo caches it against
 * this package's inputs; it runs fresh on the first CI run and re-runs whenever
 * @nextlyhq/ui changes. The token-contrast suite is the cache-correct core; this
 * is a supplementary call-site guard, deliberately narrow (text/border only,
 * evaluated on the base surface).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compositeOver, contrastRatio, type Rgb } from "../color";
import { parseThemeScale, parseThemeTokens } from "../parse-theme";
import { resolveColor, withAlpha, type ResolveContext } from "../resolve";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../..");
const css = readFileSync(resolve(here, "../../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

/**
 * Utilities that fail on the base surface but are intentional: decorative art,
 * transient indicators, or tints identified by fill + text rather than the
 * border. Each is a deliberate 1.4.11-style exception, not readable content.
 */
const ALLOWED_DECORATIVE = new Set<string>([
  "text-primary/30", // aria-hidden empty-state illustration icons
  "text-primary/20", // hover-reveal ghost buttons and sparkline decoration
  "text-primary/40", // loading spinner; meaning carried by motion + adjacent text
  "text-muted/10", // chart ring-track backing
  "border-warning-200/50", // soft border on a light tint badge (fill+text identify it)
  "border-success-900/50", // dark tonal badge border (fill+text identify it)
]);

const opaque = (c: Rgb, b: Rgb): Rgb => (c.alpha < 1 ? compositeOver(c, b) : c);

/** Every distinct `(text|border)-<token>/<NN>` utility used in admin source. */
function scanCombos(): Map<string, number> {
  const dirs = [
    "packages/ui/src/components",
    "packages/admin/src",
    "packages/plugin-form-builder/src",
    "packages/plugin-page-builder/src",
  ].map(d => `${repo}/${d}`);
  const pattern =
    "\\b(text|border)-(primary|foreground|destructive|success|warning|muted|accent|secondary)(-[0-9]+)?/[0-9]+";
  const out = execSync(`grep -rohE '${pattern}' ${dirs.join(" ")} || true`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const combos = new Map<string, number>();
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t) combos.set(t, (combos.get(t) ?? 0) + 1);
  }
  return combos;
}

/** Worst-case contrast of a `token/NN` utility, painted on the page surface. */
function worstRatio(combo: string): { ratio: number; need: number } | null {
  const m = /^(text|border)-(.+)\/(\d+)$/.exec(combo);
  if (!m) return null;
  const [, kind, name, alphaStr] = m;
  if (name === "white" || name === "black") return null;
  const alpha = Number(alphaStr) / 100;
  const need = kind === "text" ? 4.5 : 3;
  let worst = Infinity;
  for (const tokens of [light, dark]) {
    const ctx: ResolveContext = { tokens, scale };
    let base: Rgb;
    try {
      base = resolveColor(`var(--color-${name})`, ctx);
    } catch {
      return null;
    }
    const bg = opaque(resolveColor("var(--color-background)", ctx), {
      r: 1,
      g: 1,
      b: 1,
      alpha: 1,
    });
    const ratio = contrastRatio(opaque(withAlpha(base, alpha), bg), bg);
    worst = Math.min(worst, ratio);
  }
  return { ratio: worst, need };
}

describe("alpha-opacity color utilities", () => {
  const combos = scanCombos();

  it("finds utilities to scan (guards against a broken scan)", () => {
    expect(combos.size).toBeGreaterThan(0);
  });

  it("no faint text/border alpha utility falls below WCAG outside the allowlist", () => {
    const offenders: string[] = [];
    for (const combo of combos.keys()) {
      if (ALLOWED_DECORATIVE.has(combo)) continue;
      const r = worstRatio(combo);
      if (r && r.ratio < r.need) {
        offenders.push(
          `${combo} = ${r.ratio.toFixed(2)}:1 (needs ${r.need}:1)`
        );
      }
    }
    expect(
      offenders,
      `Faint alpha color utilities below WCAG on the page surface. Replace with a ` +
        `semantic token (text-muted-foreground, border-border/border-input, or the ` +
        `full-strength status token), or, if genuinely decorative, add it to ` +
        `ALLOWED_DECORATIVE with a reason:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("every allowlisted utility is still used and still needs the exception", () => {
    // Keep the allowlist honest: an entry that no longer appears, or that now
    // passes, should be removed rather than left as dead documentation.
    for (const combo of ALLOWED_DECORATIVE) {
      expect(
        combos.has(combo),
        `allowlisted ${combo} is no longer used; remove it`
      ).toBe(true);
      const r = worstRatio(combo);
      expect(
        r && r.ratio < r.need,
        `allowlisted ${combo} now passes; remove it`
      ).toBe(true);
    }
  });
});
