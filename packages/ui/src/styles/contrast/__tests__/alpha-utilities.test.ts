/**
 * Guards against faint Tailwind alpha-opacity color utilities (`text-primary/50`,
 * `border-primary/10`) creeping back into the admin. A token check cannot see
 * these because the opacity is applied per call site, not in the theme, so this
 * scans the source instead: it resolves each `text-`, `border-`, and `ring-`
 * color utility with an opacity (numeric or bracket, `ring-primary/[0.08]`),
 * composites it over the page surface, and fails any that drop below WCAG
 * unless the utility is in ALLOWED_DECORATIVE (below).
 *
 * Scope note: this reads sibling packages' source. Those trees are declared as
 * inputs to this package's `test` task (see packages/ui/turbo.json), so a change
 * in a scanned call-site package invalidates the cached result. It is a
 * supplementary call-site guard, deliberately narrow: text, border, and ring
 * color utilities, evaluated on the base surface.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  // Decorative accent rings: supplementary emphasis around a badge, dot, or
  // card that is already identified by its fill and text, not a focus indicator
  // (all focus rings are full-strength) nor a sole state cue.
  "ring-primary/20",
  "ring-primary/40",
  "ring-border/10",
  "ring-foreground/40",
  "ring-muted/5",
  "ring-success-500/20",
  "ring-success-500/40",
  "ring-destructive-500/20",
  "ring-destructive-500/40",
  // Faint hairline / dashed decorative borders, like border-subtle.
  "border-primary/[0.08]",
  "border-primary/[0.18]",
]);

const opaque = (c: Rgb, b: Rgb): Rgb => (c.alpha < 1 ? compositeOver(c, b) : c);

// The call-site packages scanned for faint alpha utilities. Every package that
// renders admin UI (Tailwind classNames) must be here; SCANNED_DIRS_COMPLETE
// below fails the build if a new one appears so it cannot go unscanned.
const SCANNED_DIRS = [
  "packages/ui/src/components",
  "packages/admin/src",
  "packages/plugin-form-builder/src",
  "packages/plugin-page-builder/src",
];

/**
 * Every distinct `(text|border|ring)-<token>/<NN>` utility used in the scanned
 * source, including arbitrary bracket opacities like `border-primary/[0.08]`.
 * Rings are included because a focus indicator is a UI boundary held to 3:1.
 */
function scanCombos(): Map<string, number> {
  const dirs = SCANNED_DIRS.map(d => `${repo}/${d}`);
  // Fail loudly if a scanned dir is missing (a moved or misspelled entry must
  // not silently scan nothing); grep's exit 1 on zero matches is not an error.
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      throw new Error(`scanned dir does not exist: ${dir}`);
    }
  }
  const pattern =
    "\\b(text|border|ring)-(primary|foreground|destructive|success|warning|muted|accent|secondary|ring|border|input)(-[0-9]+)?/(\\[[0-9.]+\\]|[0-9]+)";
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

/**
 * Worst-case contrast of a `token/NN` utility, painted on the page surface. A
 * token that fails to resolve throws (naming the utility) rather than skipping,
 * so a mistyped or removed token cannot silently bypass the assertion. The
 * scanned token names are a fixed set that all map to `--color-*`, so a failure
 * here means the theme lost a token the source still references.
 */
function worstRatio(combo: string): { ratio: number; need: number } {
  const m = /^(text|border|ring)-(.+)\/(\[[0-9.]+\]|\d+)$/.exec(combo);
  if (!m) {
    throw new Error(`unparseable alpha utility: ${combo}`);
  }
  const [, kind, name, alphaStr] = m;
  // A bracket value like `[0.08]` is already a fraction; a bare number is a
  // percentage (`/20` -> 0.2).
  const alpha = alphaStr.startsWith("[")
    ? Number(alphaStr.slice(1, -1))
    : Number(alphaStr) / 100;
  // Text needs 4.5:1; borders and focus rings are UI boundaries at 3:1.
  const need = kind === "text" ? 4.5 : 3;
  let worst = Infinity;
  for (const tokens of [light, dark]) {
    const ctx: ResolveContext = { tokens, scale };
    let base: Rgb;
    try {
      base = resolveColor(`var(--color-${name})`, ctx);
    } catch (error) {
      throw new Error(
        `${combo}: could not resolve --color-${name} (${(error as Error).message})`
      );
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

  it("scans every package that uses these alpha utilities", () => {
    // Fingerprint the packages that actually contain target utilities and fail
    // if one is not covered by SCANNED_DIRS, so a new admin-UI package cannot be
    // silently unscanned (the scan would pass while its call sites go unchecked).
    const pattern =
      "\\b(text|border|ring)-(primary|foreground|destructive|success|warning|muted|accent|secondary|ring|border|input)(-[0-9]+)?/(\\[[0-9.]+\\]|[0-9]+)";
    const hits = execSync(
      `grep -rlE '${pattern}' ${repo}/packages/*/src 2>/dev/null || true`,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const pkg = (p: string): string | null =>
      /\/packages\/([^/]+)\/src\//.exec(p)?.[1] ?? null;
    const used = new Set(
      hits
        .split("\n")
        .map(pkg)
        .filter((p): p is string => p !== null)
    );
    const scanned = new Set(
      SCANNED_DIRS.map(d => /packages\/([^/]+)\/src/.exec(d)?.[1])
    );
    for (const p of used) {
      expect(
        scanned.has(p),
        `package "${p}" uses alpha color utilities but is not in SCANNED_DIRS`
      ).toBe(true);
    }
  });

  it("no faint text/border alpha utility falls below WCAG outside the allowlist", () => {
    const offenders: string[] = [];
    for (const combo of combos.keys()) {
      if (ALLOWED_DECORATIVE.has(combo)) continue;
      const r = worstRatio(combo);
      if (r.ratio < r.need) {
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
        r.ratio < r.need,
        `allowlisted ${combo} now passes; remove it`
      ).toBe(true);
    }
  });
});
