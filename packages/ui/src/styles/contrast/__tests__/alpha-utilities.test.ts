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
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compositeOver, contrastRatio, type Rgb } from "../color";
import { parseThemeScale, parseThemeTokens } from "../parse-theme";
import { applyOpacity, resolveColor, type ResolveContext } from "../resolve";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../..");

/**
 * Every match of `pattern` in TRACKED files under `paths`.
 *
 * These assertions read the WHOLE REPOSITORY rather than this package, so
 * anything that happens to exist under a package's `src` while they run is part
 * of what they judge: a fixture another suite writes and deletes, a generated
 * file, a build artifact landing in a source tree. Each becomes a contrast
 * violation reported against a developer who never wrote the utility, in a diff
 * that does not contain it — the same shape as the recorded case where a local
 * end-to-end run's output reddened this very suite.
 *
 * Tracked files are the set these rules are about: what a component renders is
 * what somebody committed. Asking git for them excludes everything transient by
 * construction rather than by a list of things to skip.
 *
 * 🔴 The FILE LIST comes from git and the matching does not. `git grep` has its
 * own engine and does not accept `\b`, so switching to it silently matched
 * NOTHING — measured, 0 hits against 466 for the same pattern — and an empty
 * scan is what a clean repository looks like here. The same `grep -E` runs, on
 * a narrower set, so every pattern in this file keeps the meaning it was
 * written with; verified equal on a clean tree, 61 hits either way.
 *
 * An EMPTY file list throws rather than returning nothing. A pathspec that
 * matches no tracked file and a repository with no violations produce the same
 * empty string, and every assertion here reads emptiness as "no violations".
 */
function scanTracked(pattern: string, paths: readonly string[]): string {
  const listed = execSync(`git ls-files -z -- ${paths.join(" ")}`, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = listed.split("\0").filter(Boolean);
  if (tracked.length === 0) {
    throw new Error(`no tracked files under: ${paths.join(", ")}`);
  }
  // Tracked and STILL THERE. `git ls-files` lists the index, so a file deleted
  // from the working tree is still named until that deletion is staged — and
  // handing grep a path that is not there exits 2, which this treats as a real
  // failure and rethrows. Deleting a file and running the suite before staging
  // is an ordinary thing to do mid-change, and it made this scanner fail with
  // "No such file or directory" rather than scanning what remained.
  //
  // Skipped rather than refused: a file that is gone renders nothing, so it has
  // no bearing on what these rules measure. The empty-list guard above still
  // catches a pathspec that names nothing at all.
  const files = tracked.filter(file => existsSync(resolve(repo, file)));

  // Batched and invoked DIRECTLY rather than piped through `xargs`, so each
  // grep's own status is read.
  //
  // 🔴 `xargs` collapses them: it exits 123 when ANY invocation exited 1-125,
  // so one batch with no match makes the whole pipeline look like a failure
  // while the others were producing hits. Treating that as "nothing found"
  // discards every match they made — and an empty scan is exactly what a clean
  // repository looks like here, so the assertions would pass having examined
  // nothing. Measured on this tree: five grep invocations for the repo-wide
  // scan, so a silent batch is ordinary rather than hypothetical.
  //
  // Running grep directly also keeps the pattern away from a shell, so a
  // backslash in it means what the regex means.
  const found: string[] = [];
  for (let from = 0; from < files.length; from += FILES_PER_GREP) {
    const batch = files.slice(from, from + FILES_PER_GREP);
    try {
      found.push(
        execFileSync("grep", ["-HoE", pattern, ...batch], {
          cwd: repo,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        })
      );
    } catch (error) {
      // 1 is "no lines selected" for THIS batch and says nothing about the
      // others. Anything else is a real failure and must not read as silence.
      if ((error as { status?: number }).status === 1) continue;
      throw error;
    }
  }
  return found.join("");
}

/**
 * How many paths one `grep` is given.
 *
 * Small enough to stay well inside the argument-length limit on every platform
 * this runs on, large enough that the repository is a handful of invocations
 * rather than hundreds.
 */
const FILES_PER_GREP = 500;

const css = readFileSync(resolve(here, "../../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

/**
 * Utilities that fail on the base surface but are intentional: decorative art,
 * transient indicators, or tints identified by fill + text rather than the
 * border. Each is a deliberate 1.4.11-style exception, not readable content.
 */
const ALLOWED_DECORATIVE = new Set<string>([
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
  // Colour-picker handle, over a surface whose colour the USER chose. No
  // semantic token can guarantee contrast against an arbitrary background, and
  // this is the outer half of the standard two-tone handle: a light border
  // reads on dark colours, this dark ring reads on light ones. The handle's
  // POSITION carries the meaning; the ring is edge definition, and the value it
  // selects is also shown as text in the hex field beside it.
  "ring-black/60",
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
// The bracket form covers both a fraction (`[0.08]`) and a percentage
// (`[60%]`); both are valid Tailwind arbitrary opacities and normalized below.
const UTILITY_PATTERN =
  "\\b(text|border|ring)-([a-z][a-z0-9-]*)/(\\[[0-9.]+%?\\]|[0-9]+)";

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
  /^(?:text|border|ring)-(.+)\/(?:\[[0-9.]+%?\]|[0-9]+)$/.exec(combo)?.[1] ??
  null;

// Normalize a bracket opacity (`[0.08]` or `[60%]`) to a 0..1 fraction.
const parseBracketAlpha = (bracket: string): number => {
  const inner = bracket.slice(1, -1);
  return inner.endsWith("%") ? Number(inner.slice(0, -1)) / 100 : Number(inner);
};

/**
 * The surface a token renders on, so contrast is measured where it is painted
 * rather than always on the page. An on-color foreground (`primary-foreground`)
 * sits on its fill, a surface foreground on that surface, everything else on the
 * page. This keeps `text-primary-foreground/80` (light text on a dark button)
 * from reading as a page failure.
 *
 * Limitation: an on-fill foreground is measured on its SOLID fill. A foreground
 * painted over an alpha-tinted fill (`text-primary-foreground` on `bg-primary/20`)
 * would be measured too optimistically, because the guard scans utilities
 * individually and cannot see the element's paired background. On-fill foreground
 * tokens therefore belong only on their solid fill; a tinted fill should carry a
 * surface-readable text token instead. Enforcing that automatically would require
 * element-level className pairing, which this call-site scan does not do.
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
/**
 * Whether a matched path is source that RENDERS.
 *
 * Both scans in this file ask this, and they must answer identically. The
 * measuring scan skips tests because a suite naming `border-input/50` as a
 * fixture paints nothing — but the fingerprint asking a different question of
 * the same corpus would fail the run over a package whose only match is in a
 * test, demanding coverage for a file the measurement then ignores. One
 * predicate, so the two cannot disagree about what counts as UI.
 */
function rendersUi(path: string): boolean {
  return !/\.test\.|\/__tests__\//.test(path);
}

function scanCombos(): Map<string, number> {
  const dirs = SCANNED_DIRS.map(d => `${repo}/${d}`);
  // Fail loudly if a scanned dir is missing (a moved or misspelled entry must
  // not silently scan nothing); grep's exit 1 on zero matches is not an error.
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      throw new Error(`scanned dir does not exist: ${dir}`);
    }
  }
  // `-H` so the path survives: test files are excluded below, and without the
  // filename there is nothing to exclude them by. The subject here is what a
  // component RENDERS, and a test naming a class as a fixture renders nothing
  // -- a suite asserting that `border-input/50` is reported would otherwise be
  // failed by this scan for containing the string it was written to describe.
  // The sibling assertion in this file already excluded tests for the same
  // reason; this one had not, which is the inconsistency rather than the rule.
  const out = scanTracked(UTILITY_PATTERN, SCANNED_DIRS);
  const combos = new Map<string, number>();
  for (const line of out.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const path = line.slice(0, separator);
    if (!rendersUi(path)) continue;
    const t = line.slice(separator + 1).trim();
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
function worstRatio(combo: string): {
  ratio: number;
  need: number;
  /** The same token with no opacity — the best this utility could ever measure. */
  fullStrength: number;
} {
  const m = /^(text|border|ring)-(.+)\/(\[[0-9.]+%?\]|\d+)$/.exec(combo);
  if (!m) {
    throw new Error(`unparseable alpha utility: ${combo}`);
  }
  const [, kind, name, alphaStr] = m;
  // A bare number is a percentage (`/20` -> 0.2). A bracket value is a fraction
  // (`[0.08]`) unless it carries a `%` (`[60%]` -> 0.6).
  const alpha = alphaStr.startsWith("[")
    ? parseBracketAlpha(alphaStr)
    : Number(alphaStr) / 100;
  // Text needs 4.5:1; borders and focus rings are UI boundaries at 3:1.
  const need = kind === "text" ? 4.5 : 3;
  const surface = surfaceFor(name);
  let worst = Infinity;
  let worstFull = Infinity;
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
    // Scale the token's own alpha by the utility opacity (Tailwind multiplies),
    // composite over the surface, then measure the painted pixel's contrast.
    const ratio = contrastRatio(opaque(applyOpacity(base, alpha), bg), bg);
    worst = Math.min(worst, ratio);
    // The same token at FULL strength. Whether the token can reach `need` at all
    // decides what the failure means, and the two readings are different advice:
    // a token that clears it was faded too far and should be un-faded; a token
    // that does not clear it cannot be repaired by any opacity, so un-fading
    // only removes it from this scan. See the message this feeds.
    worstFull = Math.min(
      worstFull,
      contrastRatio(opaque(applyOpacity(base, 1), bg), bg)
    );
  }
  return { ratio: worst, need, fullStrength: worstFull };
}

/**
 * What to tell the reader about one failing utility.
 *
 * Two failures wear one shape here and have opposite remedies, and saying the
 * wrong one is not a cosmetic mistake: the previous message advised "replace
 * with a semantic token (border-border/…)" on findings where those tokens are
 * themselves below the target, so following it removed the utility from a scan
 * that only reads FADED utilities and changed no pixel. That advice was taken
 * once and shipped as a contrast fix.
 *
 * The suggested token depends on the KIND, because the thresholds differ.
 * `control-border` clears 1.4.11's 3:1 and is the right answer for a border or
 * ring; it measures about 3.5:1, so recommending it for TEXT — held to 4.5 —
 * would be a second remediation that still fails, which is the same defect one
 * turn later.
 *
 * Exported because the scanned corpus has no offender: with the tree clean both
 * arms are unreachable from the scan, so a regression here would be invisible to
 * it. The controls below call this directly.
 */
export function remediation(
  combo: string,
  r: { ratio: number; need: number; fullStrength: number }
): string {
  const head = `${combo} = ${r.ratio.toFixed(2)}:1 (needs ${r.need}:1)`;
  if (r.fullStrength >= r.need) {
    return `${head} — the token clears ${r.need}:1 at full strength, so use it un-faded.`;
  }
  const kind = /^text-/.test(combo) ? "text" : "border";
  const suggestion =
    kind === "text"
      ? "a text token that clears 4.5:1 (muted-foreground, foreground)"
      : "a token that holds 3:1 (control-border)";
  return (
    `${head} — and the token is only ${r.fullStrength.toFixed(2)}:1 at full ` +
    `strength, so no opacity reaches ${r.need}:1. Removing the opacity only ` +
    `hides it from this scan. Use ${suggestion}, or record it: an exclusion if ` +
    `1.4.11 does not scope the pairing, or contrast/accepted.ts if it does and ` +
    `the shortfall is a deliberate product decision.`
  );
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
    const hits = scanTracked(UTILITY_PATTERN, ["packages/*/src"]);
    const used = new Set<string>();
    for (const line of hits.split("\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      const path = line.slice(0, sep);
      // Same predicate the measuring scan uses. Without it this demands
      // coverage for a package whose only match is a test fixture -- a file
      // the measurement deliberately ignores -- so the run fails asking for
      // something that would change nothing.
      if (!rendersUi(path)) continue;
      const name = nameOf(line.slice(sep + 1).trim());
      if (!name || !isScannableColor(name)) continue;
      // `(?:^|/)` because `git ls-files` reports REPO-RELATIVE paths —
      // `packages/admin/src/...` with no leading slash. Requiring one matched
      // nothing, so `used` stayed empty and this assertion could not report the
      // very thing it exists for: a package using alpha utilities that nobody
      // added to `SCANNED_DIRS`.
      const pkg = /(?:^|\/)packages\/([^/]+)\/src\//.exec(path)?.[1];
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
    // A whole-monorepo `grep` in a subprocess, so the budget is I/O rather than
    // work this test controls. Vitest's 5s default left it about twice its own
    // measured runtime, which any parallel suite on the same machine can take
    // away; stated explicitly so a slower neighbour reads as a slower neighbour
    // rather than as this scan failing.
  }, 60_000);

  it("no faint text/border alpha utility falls below WCAG outside the allowlist", () => {
    const offenders: string[] = [];
    for (const combo of combos.keys()) {
      if (ALLOWED_DECORATIVE.has(combo)) continue;
      const r = worstRatio(combo);
      if (r.ratio < r.need) {
        offenders.push(remediation(combo, r));
      }
    }
    expect(
      offenders,
      `Faint alpha color utilities below WCAG on the page surface. Each line ` +
        `says which remedy applies — a token that clears the target un-faded, ` +
        `or one that cannot and needs a different token or an ALLOWED_DECORATIVE ` +
        `entry with a reason:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  // Both arms of the remediation, called directly. The scanned corpus has no
  // offender, so with the tree clean neither arm runs during the scan — and a
  // regression in the advice would be invisible to a suite that never reaches it.
  it("tells a caller to un-fade a token that clears the target", () => {
    const msg = remediation("border-input/50", {
      ratio: 1.9,
      need: 3,
      fullStrength: 3.4,
    });
    expect(msg).toContain("use it un-faded");
    expect(msg).not.toContain("only hides it from this scan");
  });

  it("tells a caller that no opacity reaches a target the token misses", () => {
    const msg = remediation("border-border/50", {
      ratio: 1.11,
      need: 3,
      fullStrength: 1.23,
    });
    expect(msg).toContain("only hides it from this scan");
    expect(msg).toContain("control-border");
    // The two places a sub-threshold pairing is legitimately recorded, so the
    // reader is not left with "allowlist it somewhere" as the only exit.
    expect(msg).toContain("accepted.ts");
  });

  it("does not recommend a border token for a TEXT failure", () => {
    // `control-border` measures about 3.5:1 and text is held to 4.5, so naming
    // it here would be a second remediation that still fails the threshold --
    // the exact defect this remediation exists to stop.
    const msg = remediation("text-border/50", {
      ratio: 1.1,
      need: 4.5,
      fullStrength: 1.23,
    });
    expect(msg).not.toContain("control-border");
    expect(msg).toContain("4.5:1");
  });

  it("puts no alpha on the control boundary, in any utility", () => {
    // `--nx-control-border` is the one token whose entire reason for existing is
    // to clear 1.4.11's 3:1 where `--nx-input` deliberately does not. Any alpha
    // composites it toward its surface and removes exactly that, so the
    // modifier is refused outright rather than measured -- there is no value of
    // N for which this is the right token to fade.
    //
    // Scanned across ALL utility prefixes on purpose. The pattern the rest of
    // this file uses covers `text`, `border` and `ring`; a `bg-control-border/80`
    // on the switch track was invisible to it for that reason, and rendered at
    // 2.65:1 on muted while every contrast test stayed green -- because the
    // pairings measure the TOKEN and the component was painting something else.
    // Test files are excluded because the subject is what a COMPONENT renders,
    // and because this assertion's own comment names the offending utility --
    // a scan that reads its own prose reports a hit that no user can see, which
    // is the same mistake in the opposite direction.
    const hits = scanTracked("\\b[a-z-]+-control-border/[0-9[]", [
      "packages/*/src",
    ])
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !/\.test\.|\/__tests__\//.test(line));

    expect(
      hits,
      `An opacity on --nx-control-border voids the 3:1 it exists to hold. Use ` +
        `the token at full strength, or a different token:\n${hits.join("\n")}`
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
