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

import {
  ACCEPTED_REGRESSIONS,
  acceptedFor,
  roleOf,
  type AcceptedRegression,
} from "../accepted";
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

/** One mode's two readings of a utility: as painted, and at full strength. */
interface ModeReading {
  mode: "light" | "dark";
  /** Faded and composited — what this mode actually paints. */
  ratio: number;
  /** The same token with no opacity, in THIS mode. */
  fullStrength: number;
}

/**
 * One utility's measured contrast, and the keys the reading is identified by.
 *
 * The kind is parsed ONCE, here, because two things depend on it and they must
 * not disagree: the threshold this utility is held to, and the token the remedy
 * suggests when the current one cannot reach that threshold. A second parse
 * elsewhere agrees for today's three prefixes and is free to drift the moment a
 * fourth is added.
 */
interface UtilityReading {
  /** Which prefix the utility carries, and so which threshold applies. */
  kind: "text" | "border" | "ring";
  /** 4.5:1 for text (WCAG 1.4.3), 3:1 for a UI boundary (1.4.11). */
  need: number;
  /** Worst faded ratio across both modes — what this utility actually paints. */
  ratio: number;
  /** The same token with no opacity — the best this utility could ever measure. */
  fullStrength: number;
  /** Foreground token name, as `accepted.ts` keys the foreground of a pairing. */
  fgToken: string;
  /** The surface custom property it is painted on, keyed the same way. */
  bgToken: string;
  /** The call site's opacity, which separates a tint from its opaque pair. */
  alpha: number;
  /**
   * Per mode, because an accepted regression is recorded for one mode at a time
   * — and so is the remedy. The cross-mode minimums above describe the utility
   * as a whole; a message about SOME modes has to be built from those modes,
   * or an acceptance in one theme decides the advice given for the other.
   */
  modes: readonly ModeReading[];
}

/**
 * Worst-case contrast of a `token/NN` utility across both modes, painted on the
 * surface it renders on (surfaceFor). A token that fails to resolve throws
 * (naming the utility) rather than skipping, so a mistyped or removed token
 * cannot silently bypass the assertion; the scan only admits names that map to
 * a real `--color-*`, so a throw here means the theme dropped a used token.
 */
function worstRatio(combo: string): UtilityReading {
  const m = /^(text|border|ring)-(.+)\/(\[[0-9.]+%?\]|\d+)$/.exec(combo);
  if (!m) {
    throw new Error(`unparseable alpha utility: ${combo}`);
  }
  const [, rawKind, name, alphaStr] = m;
  const kind = rawKind as UtilityReading["kind"];
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
  const modes: ModeReading[] = [];
  for (const [mode, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
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
    const full = contrastRatio(opaque(applyOpacity(base, 1), bg), bg);
    modes.push({ mode, ratio, fullStrength: full });
    // The same token at FULL strength. Whether the token can reach `need` at all
    // decides what the failure means, and the two readings are different advice:
    // a token that clears it was faded too far and should be un-faded; a token
    // that does not clear it cannot be repaired by any opacity, so un-fading
    // only removes it from this scan. See the message this feeds.
    worstFull = Math.min(worstFull, full);
  }
  return {
    kind,
    need,
    ratio: worst,
    fullStrength: worstFull,
    fgToken: name,
    bgToken: surface,
    alpha,
    modes,
  };
}

/**
 * What to tell the reader about one failing utility.
 *
 * Two failures wear one shape here and have opposite remedies, so the reading
 * decides which is named rather than the reader. A faded utility whose token
 * clears the target at full strength was faded too far, and un-fading it repairs
 * the painted pixel. A faded utility whose token does NOT clear the target
 * cannot be repaired by any opacity at all: un-fading only takes it out of a
 * scan that reads faded utilities, so the finding disappears and the contrast
 * stays exactly as it was. Naming the first remedy for the second case turns
 * this message into an instruction to hide the finding.
 *
 * The suggested token depends on the KIND, because the thresholds differ.
 * `control-border` clears 1.4.11's 3:1 and is the right answer for a border or
 * ring; it measures about 3.5:1, so naming it for TEXT — held to 4.5 — would
 * be a second remediation that still fails. The kind comes from the reading,
 * which already parsed it to choose the threshold.
 *
 * Exported because a clean tree gives the scan no offender to reach, leaving
 * both arms unreachable from it. The controls below call this directly.
 */
export function remediation(
  combo: string,
  r: UtilityReading,
  reported: readonly ModeReading[]
): string {
  // Built from the modes being REPORTED, not from the utility's cross-mode
  // minimums. A pairing accepted in one theme and failing in the other is the
  // case that separates them: the accepted theme can hold the worse full
  // strength, and reading it here would say "no opacity reaches the target"
  // about a mode that un-fading repairs.
  if (reported.length === 0) {
    // `Math.min()` of nothing is Infinity, which reads as a measured ratio and
    // prints as a confident wrong number. There is no message to write about a
    // utility with nothing to report.
    throw new TypeError(`${combo}: remediation needs at least one mode`);
  }
  const ratio = Math.min(...reported.map(m => m.ratio));
  const fullStrength = Math.min(...reported.map(m => m.fullStrength));
  const head = `${combo} = ${ratio.toFixed(2)}:1 (needs ${r.need}:1)`;
  if (fullStrength >= r.need) {
    return `${head} — the token clears ${r.need}:1 at full strength, so use it un-faded.`;
  }
  const suggestion =
    r.kind === "text"
      ? "a text token that clears 4.5:1 (muted-foreground, foreground)"
      : "a token that holds 3:1 (control-border)";
  return (
    `${head} — and the token is only ${fullStrength.toFixed(2)}:1 at full ` +
    `strength, so no opacity reaches ${r.need}:1. Removing the opacity only ` +
    `hides it from this scan. Use ${suggestion}, or record it: an exclusion if ` +
    `1.4.11 does not scope the pairing, or contrast/accepted.ts if it does and ` +
    `the shortfall is a deliberate product decision.`
  );
}

/**
 * The failing modes this scan must report — those NOT recorded in accepted.ts.
 *
 * A pairing the palette knowingly ships below its minimum is recorded once, in
 * accepted.ts, and read from there. {@link remediation} offers that file as an
 * exit, so the scan has to honour it: advice naming a remedy the guard ignores
 * leaves the reader with the same red, and pushes the entry into
 * ALLOWED_DECORATIVE instead — the list a reviewer reads to learn where 1.4.11
 * genuinely stops scoping a pairing, and so the one list that must not absorb
 * failures that ARE in scope.
 *
 * Keyed WITH the call site's opacity. An acceptance of the opaque pair says
 * nothing about a faded one: they are different colours and they measure
 * differently.
 */
function failingModes(r: UtilityReading): readonly ModeReading[] {
  return r.modes.filter(m => m.ratio < r.need);
}

function unacceptedFailures(r: UtilityReading): readonly ModeReading[] {
  // Filtered from `failingModes` rather than re-testing `ratio < need`. What
  // counts as a failure is one question, and a second copy here agrees today
  // and drifts the moment the threshold rule changes — leaving the message
  // controls green against a predicate the scan no longer uses.
  return failingModes(r).filter(
    m => !acceptedFor(r.fgToken, r.bgToken, m.mode, { fgAlpha: r.alpha })
  );
}

/*
 * 🔴 Budgeted for a repository scan, because that is what these cases do.
 *
 * `scanCombos` walks every scanned package's source for colour utilities, and
 * two cases then measure each match against both themes. On an idle machine
 * they take 2818ms and 2695ms, against vitest's 5000ms default: more than half
 * the budget with nothing else running. Under `pnpm turbo test`, which runs
 * every package's suite at once, one of them crossed it and failed a push with
 * "Test timed out in 5000ms" while passing on its own moments earlier.
 *
 * A timeout that only fires when the machine is busy reports a contrast defect
 * that does not exist, and teaches the next person to re-run rather than to
 * read it. The budget is stated on the block so a case added here inherits it,
 * and it is sized for contention rather than for the measured time.
 */
/** What this scan measured at one acceptance identity. */
interface Observation {
  /** The utility that produced it, so a failure names something greppable. */
  combo: string;
  /** Which threshold applies — the field an acceptance identity does NOT carry. */
  kind: UtilityReading["kind"];
  need: number;
  ratio: number;
}

/**
 * Every pairing this scan asks `acceptedFor` about, keyed the way it asks.
 *
 * A LIST per key rather than one entry, because the identity omits the utility
 * kind: `border-x/50` and `text-x/50` reduce to the same key while being held
 * to 3:1 and 4.5:1. Collapsing them here would hide exactly the collision the
 * assertion below exists to refuse.
 */
function observations(
  scanned: ReadonlyMap<string, number>
): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const combo of scanned.keys()) {
    if (ALLOWED_DECORATIVE.has(combo)) continue;
    const r = worstRatio(combo);
    for (const m of r.modes) {
      const key = `${roleOf(r.fgToken)}|${roleOf(r.bgToken)}|${r.alpha}|${m.mode}`;
      out.set(key, [
        ...(out.get(key) ?? []),
        { combo, kind: r.kind, need: r.need, ratio: m.ratio },
      ]);
    }
  }
  return out;
}

/**
 * Every way an accepted alpha entry can be wrong, given what the scan measured.
 *
 * Exported and pure because a clean tree records no such entry: called only
 * through the corpus, each rule below is satisfied by having nothing to judge,
 * and a regression in any of them is invisible. The controls call this with
 * inputs whose answer is known.
 *
 * `ink-utilities.test.ts` holds every accepted entry to being evaluated by
 * something, and defers exactly this shape — a faded foreground over an opaque
 * surface — because neither PAIRINGS nor its own full-strength scan composites
 * one. That deferral moved THREE guarantees here: accepted.ts promises each
 * entry is still reached, still failing, and still measuring what it records.
 */
export function acceptanceProblems(
  entries: readonly AcceptedRegression[],
  seen: ReadonlyMap<string, Observation[]>
): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    if (
      entry.fgAlpha === undefined ||
      entry.bgAlpha !== undefined ||
      entry.bgOver !== undefined
    ) {
      continue;
    }
    const where = `${entry.fg} on ${entry.bg} (${entry.mode}, /${entry.fgAlpha})`;
    const at = seen.get(
      `${entry.fg}|${entry.bg}|${entry.fgAlpha}|${entry.mode}`
    );
    if (!at || at.length === 0) {
      problems.push(
        `${where}: this scan never consults it, so nothing holds it to the ` +
          `ratio it records. Either no utility paints the pairing any more, ` +
          `or the entry was written for one that never existed.`
      );
      continue;
    }

    // An acceptance is keyed by the role pair, the mode and the alpha — and NOT
    // by the utility kind, so one entry covers `border-x/50` and `text-x/50`
    // alike while those are held to 3:1 and 4.5:1. Accepting a decorative
    // boundary would silently accept body text at the same ratio.
    const kinds = [...new Set(at.map(o => o.kind))];
    if (kinds.length > 1) {
      problems.push(
        `${where}: reached as ${kinds.join(" and ")} (${at
          .map(o => o.combo)
          .join(", ")}), which are held to different thresholds. One entry ` +
          `cannot accept both — split the pairing, or use a token per kind.`
      );
      continue;
    }

    for (const o of at) {
      // Still-failing BEFORE the ratio pin, and the order is load-bearing: any
      // repair moves the ratio too, so pinning first reports every repair as
      // drift and the stale branch never fires.
      if (o.ratio >= o.need) {
        problems.push(
          `${where}: ${o.combo} now MEETS ${o.need}:1 at ${o.ratio.toFixed(2)}:1, ` +
            `so the entry is stale. Delete it — leaving it makes the accepted ` +
            `set read as larger than it is.`
        );
        continue;
      }
      // Rounded on both sides rather than compared through a tolerance, the way
      // token-contrast pins its own entries: `toBeCloseTo(x, 2)` admits a drift
      // the file claims to pin.
      if (Number(o.ratio.toFixed(2)) !== entry.ratio) {
        problems.push(
          `${where}: recorded at ${entry.ratio}:1, ${o.combo} now measures ` +
            `${o.ratio.toFixed(2)}:1. If the change was intended, update the ` +
            `record; if not, the token moved under an entry that was never ` +
            `agreed for this value.`
        );
      }
    }
  }
  return problems;
}

describe("alpha-opacity color utilities", { timeout: 30_000 }, () => {
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
      const reported = unacceptedFailures(r);
      if (reported.length > 0) {
        offenders.push(remediation(combo, r, reported));
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

  // Both arms of the remediation, and the reading each one turns on. The
  // scanned corpus has no offender, so with the tree clean neither arm runs
  // during the scan — a regression in the advice would be invisible to a suite
  // that never reaches it. The readings come from `worstRatio` rather than from
  // literals, so a reading that stopped telling the two cases apart fails here
  // instead of leaving these agreeing with a message it no longer produces.

  it("measures full strength from the un-faded token, not the painted pixel", () => {
    // The distinction rests on measuring the SAME token twice: once at the call
    // site's opacity, once with none. A reading that took both from the faded
    // paint would report one number under two names, every failure would land
    // in the second arm, and each message control below would still pass.
    const r = worstRatio("text-foreground/30");
    expect(r.fullStrength).toBeGreaterThan(r.ratio);
  });

  it("tells a caller to un-fade a token that clears the target", () => {
    // Body text on the page surface clears 4.5:1 with room to spare, and at 30%
    // it does not — so the fade is the fault and un-fading repairs the pixel.
    const combo = "text-foreground/30";
    const r = worstRatio(combo);
    expect(r.ratio).toBeLessThan(r.need);
    expect(r.fullStrength).toBeGreaterThanOrEqual(r.need);
    const msg = remediation(combo, r, failingModes(r));
    expect(msg).toContain("use it un-faded");
    expect(msg).not.toContain("only hides it from this scan");
  });

  it("tells a caller that no opacity reaches a target the token misses", () => {
    // `theme.css` records `--nx-border` as deliberately below 3:1 to keep the
    // palette's light border weight, so no opacity reaches the target and
    // un-fading would only take the utility out of this scan.
    const combo = "border-border/50";
    const r = worstRatio(combo);
    expect(r.ratio).toBeLessThan(r.need);
    expect(r.fullStrength).toBeLessThan(r.need);
    const msg = remediation(combo, r, failingModes(r));
    expect(msg).toContain("only hides it from this scan");
    expect(msg).toContain("control-border");
    // Both places a sub-threshold pairing is legitimately recorded, and the
    // assertion above honours both, so following either one clears the finding.
    expect(msg).toContain("accepted.ts");
  });

  it("does not recommend a border token for a TEXT failure", () => {
    // `control-border` measures about 3.5:1 and text is held to 4.5, so naming
    // it here would be a second remediation that still fails the threshold --
    // the exact defect this remediation exists to stop. The kind comes from the
    // reading that chose the threshold, so a suggestion decided by a second
    // parse of the same name fails here rather than diverging quietly.
    const combo = "text-border/50";
    const r = worstRatio(combo);
    expect(r.kind).toBe("text");
    expect(r.need).toBe(4.5);
    const msg = remediation(combo, r, failingModes(r));
    expect(msg).not.toContain("control-border");
    expect(msg).toContain("4.5:1");
  });

  it("classifies from the modes it reports, not the utility's worst", () => {
    // The two themes can disagree about which remedy applies, and an acceptance
    // recorded for one of them leaves the other to be reported alone.
    // `border-input/50` is the case: 1.16:1 un-faded in light, 4.23:1 in dark.
    // A message built from the cross-mode minimum answers for light while
    // reporting dark, and tells the reader no opacity reaches a target that
    // un-fading clears.
    const combo = "border-input/50";
    const r = worstRatio(combo);
    const light = r.modes.find(m => m.mode === "light");
    const dark = r.modes.find(m => m.mode === "dark");
    if (!light || !dark) {
      throw new TypeError("a reading must carry both modes");
    }
    expect(light.fullStrength).toBeLessThan(r.need);
    expect(dark.fullStrength).toBeGreaterThanOrEqual(r.need);

    expect(remediation(combo, r, [dark])).toContain("use it un-faded");
    expect(remediation(combo, r, [light])).toContain(
      "only hides it from this scan"
    );
  });

  it("does not treat an unrecorded pairing as accepted", () => {
    // The accepted.ts exit is the one way a failing reading is NOT reported, so
    // a consult that matched everything would empty this scan silently and each
    // message control above would still pass on its own text.
    //
    // The subject is SELECTED rather than named. Naming one bakes in which
    // pairings are recorded today, so a reader following this scan's own advice
    // and adding the entry it recommends would fail this control instead of
    // clearing the finding it was added for.
    // Different PAIRINGS, not one pairing under three utility names: every
    // `*-border/50` keys to `border` on `background`, so a list of those is a
    // single candidate that only looks like three.
    const unrecorded = ["border-border/50", "border-input/50", "text-muted/30"]
      .map(combo => ({ combo, r: worstRatio(combo) }))
      .find(
        ({ r }) =>
          r.modes.some(m => m.ratio < r.need) &&
          r.modes.every(
            m =>
              acceptedFor(r.fgToken, r.bgToken, m.mode, {
                fgAlpha: r.alpha,
              }) === undefined
          )
      );
    if (!unrecorded) {
      throw new TypeError(
        "every candidate pairing is now recorded in accepted.ts; this control " +
          "needs one that is not, so add a failing utility that is unrecorded"
      );
    }
    const failing = unrecorded.r.modes.filter(m => m.ratio < unrecorded.r.need);
    expect(unacceptedFailures(unrecorded.r)).toEqual(failing);
  });

  it("vouches for the accepted entries only this scan can reach", () => {
    const seen = observations(combos);
    // The population. An empty scan satisfies every assertion below by having
    // nothing to judge, which is what a broken walk looks like from here.
    expect(seen.size).toBeGreaterThan(0);
    expect(acceptanceProblems(ACCEPTED_REGRESSIONS, seen)).toEqual([]);
  });

  describe("what makes an accepted alpha entry wrong", () => {
    // Every rule below is reached only when such an entry EXISTS, and a clean
    // tree records none — so through the corpus alone each one is satisfied by
    // having nothing to judge. These call the rule directly with inputs whose
    // answer is known.
    const KEY = "border|background|0.5|light";
    const at = (over: Partial<Observation> = {}): Map<string, Observation[]> =>
      new Map([
        [
          KEY,
          [
            {
              combo: "border-border/50",
              kind: "border",
              need: 3,
              ratio: 1.11,
              ...over,
            },
          ],
        ],
      ]);
    const record = (
      over: Partial<AcceptedRegression> = {}
    ): AcceptedRegression => ({
      fg: "border",
      bg: "background",
      mode: "light",
      fgAlpha: 0.5,
      ratio: 1.11,
      reason: "a pairing the palette ships below its minimum",
      ...over,
    });

    it("accepts an entry that still measures what it records", () => {
      // The positive control. Without it every refusal below is equally
      // consistent with a rule that rejects everything it is handed.
      expect(acceptanceProblems([record()], at())).toEqual([]);
    });

    it("refuses an entry nothing paints", () => {
      expect(acceptanceProblems([record()], new Map())[0]).toMatch(
        /never consults it/
      );
    });

    it("refuses an entry whose recorded ratio has drifted", () => {
      expect(acceptanceProblems([record({ ratio: 1.99 })], at())[0]).toMatch(
        /recorded at 1.99:1/
      );
    });

    it("refuses an entry whose pairing now meets its threshold", () => {
      // A repaired token must be DELETED from the list, not left as a false
      // confession that makes the accepted set read as larger than it is.
      expect(
        acceptanceProblems([record({ ratio: 4.2 })], at({ ratio: 4.2 }))[0]
      ).toMatch(/now MEETS 3:1/);
    });

    it("refuses one acceptance covering two utility kinds", () => {
      // `border-x/50` and `text-x/50` reduce to one identity while being held
      // to 3:1 and 4.5:1, so accepting the boundary would accept the text.
      const both = new Map([
        [
          KEY,
          [
            {
              combo: "border-border/50",
              kind: "border" as const,
              need: 3,
              ratio: 1.11,
            },
            {
              combo: "text-border/50",
              kind: "text" as const,
              need: 4.5,
              ratio: 1.11,
            },
          ],
        ],
      ]);
      const [problem] = acceptanceProblems([record()], both);
      expect(problem).toMatch(/held to different thresholds/);
      // Names BOTH utilities, so the reader can see what would have been
      // suppressed rather than only that something was.
      expect(problem).toContain("border-border/50");
      expect(problem).toContain("text-border/50");
    });

    it("ignores an entry shape another suite vouches for", () => {
      // A tinted or opaque-pair acceptance is `ink-utilities`' to evaluate.
      // Claiming it here would report it twice and, worse, hold it to a
      // measurement this scan never took.
      expect(
        acceptanceProblems([record({ fgAlpha: undefined })], at())
      ).toEqual([]);
      expect(acceptanceProblems([record({ bgAlpha: 0.1 })], at())).toEqual([]);
    });
  });

  it("keeps every kind that reaches one acceptance identity", () => {
    // The collision is invisible in the real corpus, which paints no pairing as
    // both a boundary and text — so `observations` is asked here with a scan
    // that does. Collapsing to one entry per key would hide exactly what the
    // cross-kind refusal above exists to see.
    const both = observations(
      new Map([
        ["border-border/50", 1],
        ["text-border/50", 1],
      ])
    );
    const at = both.get("border|background|0.5|light");
    if (!at) {
      throw new TypeError("both utilities must reduce to one identity");
    }
    expect(at.map(o => o.kind).sort()).toEqual(["border", "text"]);
    expect(at.map(o => o.combo).sort()).toEqual([
      "border-border/50",
      "text-border/50",
    ]);
  });

  it("derives its failures rather than re-testing the threshold", () => {
    // A behavioural mutation cannot reach this: a second copy of
    // `ratio < need` agrees with the first until the threshold rule changes,
    // which is the whole reason the duplication is worth refusing. So the
    // source is what carries it.
    const source = readFileSync(
      resolve(here, "alpha-utilities.test.ts"),
      "utf8"
    );
    const body = source.slice(
      source.indexOf("function unacceptedFailures"),
      source.indexOf("function observations")
    );
    expect(body).toContain("failingModes(r)");
    expect(body).not.toMatch(/ratio\s*<\s*r\.need/);
  });

  it("reports a mode exactly at its threshold as passing", () => {
    // `<` rather than `<=`: a utility that reaches its target is not failing,
    // and the boundary is where the two spellings differ.
    const r = worstRatio("border-border/50");
    const exact = { ...r, modes: [{ ...r.modes[0], ratio: r.need }] };
    expect(failingModes(exact)).toEqual([]);
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
