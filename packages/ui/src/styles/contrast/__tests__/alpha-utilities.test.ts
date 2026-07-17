/**
 * Guards against faint Tailwind alpha-opacity color utilities (`text-primary/50`,
 * `border-primary/10`) creeping back into the admin. A token check cannot see
 * these because the opacity is applied per call site, not in the theme, so this
 * scans the source instead: it resolves each `text-`, `border-`, and `ring-`
 * color utility with an opacity (numeric or bracket, `ring-primary/[0.08]`),
 * composites it over the surface it renders on (see surfaceFor), and fails any
 * that drop below WCAG unless the utility is in ALLOWED_DECORATIVE (below).
 *
 * Scope note: this reads sibling packages' source. Those trees are declared as
 * inputs to this package's `test` task (see packages/ui/turbo.json), so a change
 * in a scanned call-site package invalidates the cached result. It is a
 * supplementary call-site guard for text, border, and ring color utilities.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compositeOver, contrastRatio, type Rgb } from "../color";
import { parseThemeScale, parseThemeTokens } from "../parse-theme";
import { applyOpacity, resolveColor, type ResolveContext } from "../resolve";

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
  "ring-border/50", // neutral activity-badge outline (~1.7:1 once the token's own alpha compounds); same decorative role as the colored ring siblings
  "ring-foreground/40",
  "ring-muted/5",
  "ring-success-500/20",
  "ring-success-500/40",
  "ring-destructive-500/20",
  "ring-destructive-500/40",
  // Faint hairline / dashed decorative borders, like border-subtle.
  "border-primary/[0.08]",
  "border-primary/[0.18]",
  // The faint track of a CSS spinner on a primary button; border-t is the solid
  // moving indicator and the spinner is a transient loading affordance.
  "border-primary-foreground/30",
  // Supplementary hover outline; the hover state is conveyed by bg-accent and
  // its text, so the thin border is decorative.
  "border-accent-foreground/20",
  // Hardcoded white/black palette utilities. The scan cannot know their local
  // surface (they render on dark scrims or over media, not the page), so each
  // is listed here with the surface that makes it readable, rather than left to
  // silently bypass the check.
  "text-white/60", // schema-restart overlay text on a bg-black/75 scrim (~4.9:1)
  "text-white/70", // caption over a media thumbnail with a dark gradient scrim
  "text-white/80", // gallery-node label over a media thumbnail scrim
  "border-black/5", // decorative hairline separator
  "border-white/5", // decorative hairline separator in dark mode
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

// Match any color utility with an opacity; the name is captured broadly so
// multi-segment tokens (`muted-foreground`) are caught, then validated against
// real theme colors below, which drops non-color matches (`text-sm/50`).
const UTILITY_PATTERN =
  "\\b(text|border|ring)-([a-z][a-z0-9-]*)/(\\[[0-9.]+\\]|[0-9]+)";

// Every name a `--color-*` utility can carry, from the theme's @theme block.
const COLOR_NAMES = new Set(
  [...scale.keys()].map(k => k.replace("--color-", ""))
);

// Names the scan resolves to a real color: theme tokens plus Tailwind's built-in
// `white`/`black`, which are not in the @theme block but still render (and so
// could otherwise slip a faint `text-white/60` past the check). Everything else
// (`text-sm/50`) is dropped.
const isScannableColor = (name: string): boolean =>
  COLOR_NAMES.has(name) || name === "white" || name === "black";

const nameOf = (combo: string): string | null =>
  /^(?:text|border|ring)-(.+)\/(?:\[[0-9.]+\]|[0-9]+)$/.exec(combo)?.[1] ??
  null;

/**
 * The surface a token renders on, so contrast is measured where it is painted
 * rather than always on the page. An on-color foreground (`primary-foreground`)
 * sits on its fill, a surface foreground on that surface, everything else on the
 * page. This keeps `text-primary-foreground/80` (light text on a dark button)
 * from reading as a page failure.
 *
 * Assumption: an on-fill foreground sits on its SOLID fill, the common case. A
 * foreground token painted over an alpha-tinted fill (`text-primary-foreground`
 * on `bg-primary/20`) is not modeled and would be measured too optimistically;
 * no such pairing exists in the scanned source today. Reintroducing one means
 * modeling the real tinted surface here.
 */
const ON_FILL_FOREGROUND =
  /^(primary|secondary|accent|destructive|success|warning|highlight|sidebar-primary|sidebar-accent)-foreground$/;
function surfaceFor(name: string): string {
  if (name === "sidebar-foreground") return "--color-sidebar-background";
  if (name === "card-foreground") return "--color-card";
  if (name === "popover-foreground") return "--color-popover";
  if (ON_FILL_FOREGROUND.test(name)) {
    return `--color-${name.slice(0, -"-foreground".length)}`;
  }
  return "--color-background";
}

/**
 * Every distinct color utility with an opacity used in the scanned source,
 * including multi-segment names (`text-muted-foreground`) and bracket
 * opacities (`border-primary/[0.08]`). Rings are included because a focus
 * indicator is a UI boundary held to 3:1.
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
  const out = execSync(
    `grep -rohE '${UTILITY_PATTERN}' ${dirs.join(" ")} || true`,
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  const combos = new Map<string, number>();
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const name = nameOf(t);
    if (name && isScannableColor(name)) {
      combos.set(t, (combos.get(t) ?? 0) + 1);
    }
  }
  return combos;
}

/**
 * Worst-case contrast of a `token/NN` utility across both modes, painted on the
 * surface it renders on (surfaceFor). A token that fails to resolve throws
 * (naming the utility) rather than skipping, so a mistyped or removed token
 * cannot silently bypass the assertion; the scan only admits names that map to
 * a real `--color-*`, so a throw here means the theme dropped a used token.
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
  const surface = surfaceFor(name);
  let worst = Infinity;
  for (const tokens of [light, dark]) {
    const ctx: ResolveContext = { tokens, scale };
    let base: Rgb;
    try {
      // `white`/`black` are Tailwind built-ins with no `--color-*` token; resolve
      // them as the keyword. Everything else is a theme token.
      base =
        name === "white" || name === "black"
          ? resolveColor(name, ctx)
          : resolveColor(`var(--color-${name})`, ctx);
    } catch (error) {
      throw new Error(
        `${combo}: could not resolve ${name} (${(error as Error).message})`
      );
    }
    const bg = opaque(resolveColor(`var(${surface})`, ctx), {
      r: 1,
      g: 1,
      b: 1,
      alpha: 1,
    });
    const ratio = contrastRatio(opaque(applyOpacity(base, alpha), bg), bg);
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
    // Fingerprint the packages that actually contain color alpha utilities and
    // fail if one is not covered by SCANNED_DIRS, so a new admin-UI package
    // cannot be silently unscanned. Matches are filtered to real theme colors,
    // matching the scan, so a package using only non-color opacities is ignored.
    const hits = execSync(
      `grep -rHoE '${UTILITY_PATTERN}' ${repo}/packages/*/src 2>/dev/null || true`,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const used = new Set<string>();
    for (const line of hits.split("\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      const name = nameOf(line.slice(sep + 1).trim());
      if (!name || !isScannableColor(name)) continue;
      const pkg = /\/packages\/([^/]+)\/src\//.exec(line.slice(0, sep))?.[1];
      if (pkg) used.add(pkg);
    }
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
