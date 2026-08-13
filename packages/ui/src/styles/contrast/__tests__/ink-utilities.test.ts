/**
 * Every token painted as INK must be readable on the surfaces it can land on.
 *
 * The token-pair suite asserts the pairs the THEME declares: `accent` against
 * `accent-foreground`, `primary` against `primary-foreground`. It says nothing
 * about which token a component actually reaches for, so a component painting
 * text with a token meant as a background is green everywhere -- the pair it
 * renders is in nobody's list. That is how a profile icon came to be drawn in
 * `accent` (1.09:1 against the row behind it) and a focus ring in the same
 * token (1.33:1, against a 3:1 requirement), while every assertion passed.
 *
 * So this scans for the utilities that paint ink -- `text-*`, `ring-*`,
 * `decoration-*`, `caret-*`, `placeholder-*` -- resolves each through the theme,
 * and measures it against every surface a component can sit on, in both modes.
 * It is deliberately a contrast check rather than a role check: `primary`,
 * `destructive`, `success` and `warning` are surfaces AND legitimate ink, and a
 * rule phrased as "a token with an `-foreground` partner is a background" would
 * reject 235 correct uses to catch 2 wrong ones. The measured separation is
 * wide -- the worst legitimate ink is 4.58:1 and the best misuse is 1.66:1 --
 * so the numbers draw the line the roles cannot.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACCEPTED_REGRESSIONS,
  acceptedFor,
  roleOf,
  type AcceptedRegression,
} from "../accepted";
import { PAIRINGS } from "../pairings";
import { compositeOver, contrastRatio, type Rgb } from "../color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { applyOpacity, resolveColor } from "../resolve";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../..");
const themeCss = readFileSync(resolve(here, "../../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);

/** Packages whose components render inside the admin shell. */
const SCANNED = ["packages/admin/src", "packages/ui/src"];
const EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

/**
 * The backdrops a component can be painted onto. Ink has to clear its minimum
 * against all of them, because a component does not know which one it will
 * land on -- the same row renders on the page, inside a card and inside a
 * popover.
 */
const PAGE_SURFACES = [
  "--nx-background",
  // The page container is its own token and is DARKER than `--nx-background`;
  // in dark mode the two are 0.23 apart in lightness. Omitting it measured ink
  // against a backdrop the page does not paint.
  "--nx-page-background",
  "--nx-card",
  "--nx-muted",
  "--nx-popover",
  "--nx-sidebar-background",
];

/**
 * WCAG 1.4.3 for text, 1.4.11 for a focus indicator. `ring` is a boundary
 * rather than a glyph, so it carries the non-text minimum.
 */
const REQUIRED = { text: 4.5, ring: 3 } as const;

/**
 * One whole class token: an optional variant chain, a property prefix, a role,
 * an optional opacity modifier and an optional `!`.
 *
 * Anchored at both ends (`^`/`$`) because it is applied to an ALREADY SPLIT
 * token rather than scanned across a string. A class attribute is
 * whitespace-delimited by definition, so splitting first and matching whole
 * tokens removes every delimiter assumption at once -- and those assumptions
 * were the bug. A scanning pattern needed a trailing delimiter, which skipped
 * the LAST utility in every class string; that is exactly where a `dark:`
 * override is conventionally written, so dark ink went unseen while the light
 * ink it replaces was scored against the dark surface. Four other
 * false-positive rounds came from the same family. Tokenising does not fix
 * that bug so much as make it unrepresentable.
 */
const CLASS_TOKEN =
  /^((?:[a-z][a-z0-9-]*:)*)(text|ring|decoration|caret|placeholder|bg)-([a-z][a-z0-9-]*?)(\/(?:\[[0-9.]+%?\]|\d+))?!?$/;

/** Properties that paint ink, as opposed to the fill it is painted on. */
const INK_PREFIXES = new Set([
  "text",
  "ring",
  "decoration",
  "caret",
  "placeholder",
]);

/**
 * Files that apply classes. A module that only DESCRIBES utilities -- a doc
 * comment quoting `bg-warning-100 text-warning-700` as an example -- renders
 * nothing, and reading its prose as markup reports a component that does not
 * exist.
 */
const APPLIES_CLASSES = /className|class=|\bcva\(|\bcn\(/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(extname(full))) found.push(full);
  }
  return found;
}

const sources = SCANNED.flatMap(root => walk(resolve(repo, root)))
  .map(path => relative(repo, path))
  .filter(
    path => !/(^|\/)__tests__\//.test(path) && !/\.test\.[jt]sx?$/.test(path)
  );

/**
 * The fills an `-foreground` ink is declared for, derived from what the theme
 * declares rather than listed:
 *
 * - `<role>` itself, the ordinary pairing.
 * - `<role>-background`, because the sidebar names its surface that way while
 *   its ink is plain `sidebar-foreground`.
 * - `<role>-solid`, the button-fill variant. The theme keeps it darker than the
 *   base precisely so on-colour button text still clears its minimum, so it is
 *   the same role wearing its fill hat.
 */
function surfacesFor(partner: string): string[] {
  return [partner, `${partner}-background`, `${partner}-solid`].filter(name =>
    scale.has(`--color-${name}`)
  );
}

/**
 * An `-foreground` token painted on its own partner rather than on the page.
 * `primary-foreground` is white BECAUSE it sits on the primary fill, so
 * measuring it against the page would reject it for being correct.
 *
 * The exception is a partner of a surface that IS a page backdrop --
 * `foreground` on `background`, `muted-foreground` on `muted` -- which is page
 * ink and stays in scope.
 */
function isInkOnItsOwnFill(role: string): boolean {
  if (!role.endsWith("-foreground")) return false;
  const partner = role.slice(0, -"-foreground".length);
  return !surfacesFor(partner).some(name =>
    PAGE_SURFACES.includes(`--nx-${name}`)
  );
}

/** An accepted pair this scan actually reached, with what it measured. */
interface Observed {
  accepted: AcceptedRegression;
  ratio: number;
  required: number;
  where: string;
}

const observed: Observed[] = [];

interface Miss {
  utility: string;
  role: string;
  mode: string;
  surface: string;
  ratio: number;
  required: number;
  where: string;
}

/**
 * A utility's colour, resolved the way the compiled stylesheet resolves it.
 *
 * Goes through `--color-*` rather than `--nx-*` because that is the name a
 * utility actually compiles to, and it is the only route that reaches the
 * status SHADES: `destructive-700` has no `--nx-` token at all, it is
 * `color-mix(in srgb, var(--nx-destructive), black 30%)` in the `@theme` block.
 * Resolving only `--nx-*` left every shade unmeasured -- 88 uses of
 * `text-destructive-*` and friends -- while reporting a clean run.
 */
function colorOf(role: string, tokens: TokenMap): Rgb | null {
  try {
    return resolveColor(`var(--color-${role})`, { tokens, scale });
  } catch {
    // Not every token has a `--color-*` alias. `--nx-page-background` is
    // declared but never mapped into `@theme`, so asking only for the Tailwind
    // name returned nothing and every pair against that surface was skipped in
    // silence -- a surface added specifically to be measured that contributed
    // no measurement at all. Fall back to the `--nx-*` name, which is where the
    // value actually lives.
    try {
      return resolveColor(`var(--nx-${role})`, { tokens, scale });
    } catch {
      // Fall through to the null return below.
    }
    // Not a theme colour: a Tailwind palette name (`text-white`), a non-colour
    // utility sharing the prefix (`text-xs`, `ring-2`), or a typo. Counted and
    // pinned below rather than dropped.
    return null;
  }
}

function ratiosFor(
  role: string,
  tokens: TokenMap,
  against: readonly string[] = PAGE_SURFACES
): Map<string, number> | null {
  const ink = colorOf(role, tokens);
  if (!ink) return null;

  const measured = new Map<string, number>();
  for (const surface of against) {
    const bg = colorOf(surface.replace(/^--nx-/, ""), tokens);
    // A fill the component names that is not a theme colour tells us nothing
    // about this pairing; the remaining fills still constrain the ink.
    if (bg) measured.set(surface, contrastRatio(ink, bg));
  }
  // A component whose only named fill is unresolvable falls back to the
  // surfaces it could otherwise land on.
  if (measured.size === 0 && against !== PAGE_SURFACES) {
    return ratiosFor(role, tokens, PAGE_SURFACES);
  }
  return measured;
}

/** The opaque fills a set of utilities names, as token references. */
function namedSurfaces(
  fills: readonly Utility[]
): readonly string[] | undefined {
  const named = [...new Set(fills.map(fill => `--nx-${fill.role}`))];
  return named.length > 0 ? named : undefined;
}

/**
 * Ink measured against a translucent fill blended over each page surface.
 *
 * The key is the surface the tint sits ON, not the blend, because that is what
 * identifies the pair: `destructive/10 over card` and `destructive/10 over page`
 * are different colours and different acceptances. `accepted.ts` keys them the
 * same way through {@link PairDetail}.
 */
function tintedRatios(
  role: string,
  tint: Utility,
  tokens: TokenMap
): Map<string, number> | null {
  const ink = colorOf(role, tokens);
  const fill = colorOf(tint.role, tokens);
  // Without a resolvable tint there is nothing to blend, so fall back to the
  // bare surfaces rather than silently measuring nothing.
  if (!ink || !fill) return ratiosFor(role, tokens);

  const measured = new Map<string, number>();
  for (const surface of PAGE_SURFACES) {
    const base = colorOf(surface.replace(/^--nx-/, ""), tokens);
    if (!base) continue;
    const blended = compositeOver(applyOpacity(fill, tint.alpha ?? 1), base);
    measured.set(surface, contrastRatio(ink, blended));
  }
  return measured;
}

/**
 * An opacity modifier as a fraction: `/10` is 0.1, `/[12.5%]` is 0.125. Written
 * as a bare number Tailwind reads it as a percentage, and the bracketed form
 * may carry its own `%`.
 */
function parseAlpha(modifier: string): number | undefined {
  const inner = modifier.replace(/^\//, "");
  const bracketed = inner.startsWith("[");
  const body = inner.replace(/^\[|\]$/g, "");
  const percent = body.endsWith("%");
  const value = Number.parseFloat(body.replace(/%$/, ""));
  if (!Number.isFinite(value)) return undefined;

  // Three spellings, two scales. A bare modifier (`/10`) and a bracketed one
  // carrying its own sign (`/[4%]`) are percentages. A bracketed value WITHOUT
  // a sign (`/[0.04]`) is already a fraction, and dividing it again yields
  // 0.0004 -- a fill so close to transparent that the ink measures against the
  // bare surface, which is the very error compositing the tint was added to
  // fix. There are live `bg-primary/[0.04]` call sites, so this is not
  // hypothetical.
  return bracketed && !percent ? value : value / 100;
}

interface Utility {
  /** `text`, `ring`, `bg`, ... */
  prefix: string;
  /** The colour role: `destructive-700`, `muted-foreground`. */
  role: string;
  /** Variant chain as written, e.g. `dark:hover:`. */
  variant: string;
  /** Variants other than `dark`, which is what makes two utilities siblings. */
  state: string;
  /** A translucent fill composites over what is behind it. */
  translucent: boolean;
  /**
   * The opacity modifier as a fraction, when one is written. Retained rather
   * than reduced to a boolean because a tint's ALPHA decides the colour the ink
   * actually lands on, and discarding it made the check measure the surface
   * under the tint instead of the blend on top of it.
   */
  alpha?: number;
  /** Ink with an opacity modifier: a wash, not something carrying meaning. */
  decorative: boolean;
  appliesInDark: boolean;
  appliesInLight: boolean;
}

/**
 * Which mode a utility applies in, resolved the way the cascade resolves it.
 *
 * `dark:text-warning-400` is only ever seen in dark mode, and a bare
 * `text-warning-800` written beside it is only seen in light. Measuring either
 * one in the other mode compares an ink that is not painted with a fill that is
 * not there -- which is how a first cut of this check reported 19 failures, all
 * of them pairs the browser never renders together.
 */
function withModes(found: Utility[]): Utility[] {
  return found.map(utility => {
    const isDark = utility.variant.split(":").includes("dark");
    const overriddenInDark = found.some(
      other =>
        other !== utility &&
        other.prefix === utility.prefix &&
        other.state === utility.state &&
        other.variant.split(":").includes("dark")
    );
    return {
      ...utility,
      appliesInLight: !isDark,
      appliesInDark: isDark || !overriddenInDark,
    };
  });
}

/**
 * Every quoted span in a source, which is where class strings live.
 *
 * Spans are taken whole rather than searched for utilities, so the unit of
 * analysis is the same one the browser gets: a set of classes applied together.
 * A template literal with an interpolation splits into several spans, which is
 * harmless -- each piece is still a complete set of whitespace-delimited
 * tokens.
 */
const QUOTED_SPAN = /(["'`])([^"'`]*)\1/g;

/** The utilities in one class string, split on whitespace and matched whole. */
function parseUtilities(classString: string): Utility[] {
  const found: Utility[] = [];
  for (const token of classString.split(/\s+/)) {
    const match = CLASS_TOKEN.exec(token);
    if (!match) continue;
    const [, variant = "", prefix = "", role = "", opacity] = match;
    found.push({
      prefix,
      role,
      variant,
      state: variant
        .split(":")
        .filter(part => part && part !== "dark")
        .join(":"),
      translucent: prefix === "bg" && Boolean(opacity),
      alpha: opacity ? parseAlpha(opacity) : undefined,
      appliesInDark: true,
      appliesInLight: true,
      // An ink utility carrying an opacity modifier is a decorative wash --
      // a chart track, a tinted overlay -- and is not asserted. Writing one is
      // how a deliberate exception is expressed, and it is visible in the diff.
      decorative: INK_PREFIXES.has(prefix) && Boolean(opacity),
    });
  }
  return withModes(found);
}

/**
 * Every ink utility in the scanned sources, paired with the class string it was
 * written in and the line it sits on.
 *
 * Iterating class strings rather than scanning for utilities is what makes the
 * fill pairing exact: the fills a component names for itself are, by
 * construction, the other tokens in the same span.
 */
function* inkUsages(): Generator<{
  path: string;
  line: number;
  self: Utility;
  utilities: Utility[];
}> {
  for (const path of sources) {
    const source = readFileSync(resolve(repo, path), "utf8");
    if (!APPLIES_CLASSES.test(source)) continue;
    for (const span of source.matchAll(QUOTED_SPAN)) {
      const utilities = parseUtilities(span[2] ?? "");
      if (utilities.length === 0) continue;
      const line = source.slice(0, span.index).split("\n").length;
      for (const self of utilities) {
        if (!INK_PREFIXES.has(self.prefix) || self.decorative) continue;
        yield { path, line, self, utilities };
      }
    }
  }
}

const misses: Miss[] = [];
const resolvedRoles = new Set<string>();
const unresolvedRoles = new Set<string>();

for (const { path, line, self, utilities } of inkUsages()) {
  {
    const { variant, prefix, role } = self;
    const utility = `${variant}${prefix}-${role}`;
    if (isInkOnItsOwnFill(role)) continue;

    const required = prefix === "ring" ? REQUIRED.ring : REQUIRED.text;
    let resolvedAny = false;

    for (const [mode, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      if (!(mode === "dark" ? self.appliesInDark : self.appliesInLight)) {
        continue;
      }

      // A ring is drawn OUTSIDE the box, so it is seen against whatever the
      // element sits on and never against the element's own fill. Pairing it
      // with `bg-*` would score a hover ring against the hover fill it is meant
      // to outline, and call an outline invisible for being an outline.
      const fills =
        prefix === "ring"
          ? []
          : utilities.filter(
              candidate =>
                candidate.prefix === "bg" &&
                (mode === "dark"
                  ? candidate.appliesInDark
                  : candidate.appliesInLight)
            );

      // Fills that apply in the same state as this ink. `hover:bg-primary`
      // pairs with `hover:text-primary-foreground`, not with the resting
      // `text-primary` that sits on the page until the pointer arrives. A state
      // with no fill of its own inherits the unprefixed one, which does not
      // change on hover.
      const sameState = fills.filter(fill => fill.state === self.state);
      const inherited = fills.filter(fill => fill.state === "");
      const effective = sameState.length > 0 ? sameState : inherited;

      // A translucent fill composites over whatever is behind it. Which page
      // surface that is cannot be known here, so the tint is blended over EACH
      // of them and the ink measured against every result.
      //
      // Falling through to the bare page surfaces instead -- the previous
      // behaviour -- measures a colour the ink never touches. `text-destructive`
      // on `bg-destructive/10` reads 3.73:1 against the page and 3.29:1 against
      // the blend that is actually painted, so the check reported the pair as
      // better than it renders, and an acceptance recorded from it understated
      // the cost of the palette by a fifth of a point.
      const tint = effective.find(fill => fill.translucent);
      const measured = tint
        ? tintedRatios(role, tint, tokens)
        : ratiosFor(role, tokens, namedSurfaces(effective));
      if (!measured) continue;
      resolvedAny = true;
      // When the component NAMES its own fill, clearing the bar on any one of
      // them is enough: it tells us which surface this ink actually lands on.
      // Falling back to the page surfaces carries no such knowledge, so every
      // one of them has to hold. A tint is measured over all of them and is in
      // the second case.
      const declared = !tint && namedSurfaces(effective) !== undefined;
      if (declared && Math.max(...measured.values()) >= required) continue;
      for (const [surface, ratio] of measured) {
        if (ratio >= required) continue;
        // A pair the palette knowingly ships below its minimum is recorded once
        // in accepted.ts and read from there, rather than listed again here.
        // Two lists of accepted failures drift apart silently, each looking
        // complete on its own, and this scan reaches the same colours through
        // utility names rather than token names -- which is exactly the shape
        // that makes a second list look like a different subject.
        // Keyed WITH the tint. An opaque acceptance must not cover a tinted
        // variant of the same roles: they are different colours, they measure
        // differently, and accepting one on the strength of the other is how
        // the ledger came to understate what renders.
        const accepted = tint
          ? acceptedFor(role, tint.role, mode, {
              bgAlpha: tint.alpha,
              bgOver: surface,
            })
          : acceptedFor(role, surface, mode);
        if (accepted) {
          // Some accepted pairs are reached ONLY here -- the token pairing list
          // never names them -- so this scan is the only place their recorded
          // ratio can be held to anything. Suppressing without checking would
          // leave those entries unpinned in both suites: a surface change could
          // worsen the pair, or repair it, and accepted.ts would go stale with
          // everything still green.
          observed.push({
            accepted,
            ratio,
            required,
            where: `${path}:${line}`,
          });
          continue;
        }
        misses.push({
          utility,
          role,
          mode,
          surface,
          ratio,
          required,
          where: `${path}:${line}`,
        });
      }
    }
    (resolvedAny ? resolvedRoles : unresolvedRoles).add(role);
  }
}

describe("ink utilities are readable on the surfaces they land on", () => {
  it("holds accepted pairs to their recorded ratio", () => {
    // Some accepted pairs have no entry in PAIRINGS -- this scan is the only
    // thing that reaches them -- so if the suppression above were unconditional
    // they would be pinned nowhere. The same two properties the token suite
    // enforces are enforced here, for whatever this scan actually observed.
    const drifted = observed
      .filter(o => Number(o.ratio.toFixed(2)) !== o.accepted.ratio)
      .map(
        o =>
          `${o.accepted.fg} on ${o.accepted.bg} (${o.accepted.mode}) recorded ` +
          `${o.accepted.ratio}:1, measured ${o.ratio.toFixed(2)}:1 — ${o.where}`
      );

    expect(
      [...new Set(drifted)].sort(),
      `An accepted pair no longer measures what accepted.ts records. If the ` +
        `change was intended, update the recorded ratio; if not, a token moved ` +
        `under an entry that was not agreed for this value.`
    ).toEqual([]);
  });

  it("reads all three opacity spellings at the right scale", () => {
    // Tailwind accepts a bare percentage, a bracketed percentage, and a
    // bracketed fraction, and the last two look alike while meaning the same
    // number written two ways. Getting the scale wrong is silent: the tint
    // becomes near-transparent, the ink measures against the bare surface, and
    // the check reports the pair as better than it renders.
    expect(parseAlpha("/10")).toBeCloseTo(0.1, 6);
    expect(parseAlpha("/[4%]")).toBeCloseTo(0.04, 6);
    expect(parseAlpha("/[0.04]")).toBeCloseTo(0.04, 6);
    // The two bracketed forms describe one colour, so they must agree.
    expect(parseAlpha("/[4%]")).toBe(parseAlpha("/[0.04]"));
    expect(parseAlpha("/nonsense")).toBeUndefined();
  });

  it("requires every acceptance to be reached by something", () => {
    // Token existence is not enough. An entry whose call sites all disappear
    // stops being evaluated by either suite while both roles remain declared,
    // so it sits in the file reading as live coverage -- and pre-accepts the
    // next component that happens to paint that pair.
    //
    // This is the assertion that can see both sources: PAIRINGS for entries the
    // token suite evaluates, and `observed` for the ones only this scan reaches.
    const byPairing = new Set(
      PAIRINGS.flatMap(p => {
        const key = `${roleOf(p.fg)}|${roleOf(p.bg)}|${p.fgAlpha ?? "-"}|${p.bgAlpha ?? "-"}|${p.bgOver ? roleOf(p.bgOver) : "-"}`;
        return p.mode === undefined
          ? [`${key}|light`, `${key}|dark`]
          : [`${key}|${p.mode}`];
      })
    );
    const byScan = new Set(
      observed.map(
        o =>
          `${o.accepted.fg}|${o.accepted.bg}|${o.accepted.fgAlpha ?? "-"}|` +
          `${o.accepted.bgAlpha ?? "-"}|${o.accepted.bgOver ? roleOf(o.accepted.bgOver) : "-"}|${o.accepted.mode}`
      )
    );

    const unreached = ACCEPTED_REGRESSIONS.filter(entry => {
      const key =
        `${entry.fg}|${entry.bg}|${entry.fgAlpha ?? "-"}|${entry.bgAlpha ?? "-"}|` +
        `${entry.bgOver ? roleOf(entry.bgOver) : "-"}|${entry.mode}`;
      return !byPairing.has(key) && !byScan.has(key);
    }).map(entry => `${entry.fg} on ${entry.bg} (${entry.mode})`);

    expect(
      unreached,
      `These accepted-regression entries are evaluated by nothing: no pairing ` +
        `covers them and no component paints them. Delete them — an ` +
        `unreachable acceptance is not documentation, it is a standing ` +
        `permission for whatever paints that pair next.`
    ).toEqual([]);
  });

  it("requires a repaired pair to leave the accepted set", () => {
    const repaired = observed
      .filter(o => o.ratio >= o.required)
      .map(
        o =>
          `${o.accepted.fg} on ${o.accepted.bg} (${o.accepted.mode}) now ` +
          `measures ${o.ratio.toFixed(2)}:1, at or above its ${o.required}:1`
      );

    expect(
      [...new Set(repaired)].sort(),
      `These pairs now MEET their threshold, so their accepted.ts entries are ` +
        `stale. Delete them: leaving them makes the accepted set read as ` +
        `larger than it is.`
    ).toEqual([]);
  });

  it("resolves every surface it claims to measure against", () => {
    // Adding a surface to PAGE_SURFACES is not the same as measuring against
    // it. `--nx-page-background` has no `--color-*` alias, so the resolver
    // returned nothing and every pair against it was skipped in silence -- a
    // surface added specifically to be measured that contributed no
    // measurement, while the suite stayed green and read as wider coverage
    // than it had.
    //
    // An unresolvable surface can only ever REMOVE assertions, so nothing
    // downstream can notice its absence. This is the positive control that
    // makes the list's own reachability observable.
    const unresolved: string[] = [];
    for (const [mode, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      for (const surface of PAGE_SURFACES) {
        if (!colorOf(surface.replace(/^--nx-/, ""), tokens)) {
          unresolved.push(`${surface} (${mode})`);
        }
      }
    }

    expect(
      unresolved,
      `These surfaces are listed in PAGE_SURFACES but resolve to no colour, so ` +
        `every pair against them is skipped rather than measured. Give the ` +
        `token a name the resolver can reach, or remove it from the list so ` +
        `the coverage it implies is not claimed.`
    ).toEqual([]);
  });

  it("scans the components and resolves tokens on both sides", () => {
    // Every assertion below is vacuously true over an empty scan, so a renamed
    // directory or a changed utility syntax must fail here first.
    expect(sources.length).toBeGreaterThan(100);
    expect(resolvedRoles.size).toBeGreaterThan(3);
  });

  it("reads a whole class token, wherever it sits in the string", () => {
    // Position independence is the property tokenising buys, so it is pinned
    // rather than assumed: the FIRST and LAST utilities are the two a scanning
    // pattern gets wrong, and the last one is where `dark:` overrides live.
    const parsed = parseUtilities(
      "text-warning-800 bg-warning-100 dark:bg-warning-900 dark:text-warning-100"
    );
    expect(
      parsed.map(
        utility => `${utility.variant}${utility.prefix}-${utility.role}`
      )
    ).toEqual([
      "text-warning-800",
      "bg-warning-100",
      "dark:bg-warning-900",
      "dark:text-warning-100",
    ]);

    // And the cascade the parse feeds: each side applies in exactly one mode.
    const [lightInk, , , darkInk] = parsed;
    expect([lightInk?.appliesInLight, lightInk?.appliesInDark]).toEqual([
      true,
      false,
    ]);
    expect([darkInk?.appliesInLight, darkInk?.appliesInDark]).toEqual([
      false,
      true,
    ]);

    // An opacity modifier marks ink decorative and a fill translucent.
    const washed = parseUtilities("text-muted/10 bg-primary/[0.04]");
    expect(
      washed.map(utility => [utility.decorative, utility.translucent])
    ).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("proves the measurement would catch a background used as ink", () => {
    // `accent` is a hover surface in every mode. If this ever clears the text
    // minimum, the palette has changed enough that the real assertion below is
    // no longer testing what it claims.
    for (const tokens of [light, dark]) {
      const measured = ratiosFor("accent", tokens);
      expect(measured).not.toBeNull();
      const worst = Math.min(...(measured as Map<string, number>).values());
      expect(worst).toBeLessThan(REQUIRED.ring);
    }
  });

  it("reports what it could not resolve rather than skipping silently", () => {
    // A name this cannot resolve is not checked, so the set is pinned: it may
    // shrink freely, but a NEW unresolvable role is a gap in coverage that
    // should be looked at rather than absorbed.
    const unexpected = [...unresolvedRoles].filter(
      role =>
        role.includes("-") &&
        /^(primary|destructive|success|warning|accent|muted|secondary|card|popover|sidebar|border|input|ring|foreground|background|highlight|code|chart|overlay|shadow|table)/.test(
          role
        )
    );
    expect(
      unexpected,
      `These look like theme roles but did not resolve to an --nx-* token, so ` +
        `nothing measured them:\n${unexpected.map(r => `  ${r}`).join("\n")}`
    ).toEqual([]);
  });

  it("paints every -foreground ink on the surface it is declared for", () => {
    // `accent-foreground` exists BECAUSE something is painted on `accent`. A
    // component that pairs it with any other fill makes a combination no
    // assertion covers -- the token-pair suite checks the declared partners and
    // passes, while the screen shows a pairing nobody scored. That is how an
    // active sidebar row shipped with `sidebar-accent-foreground` ink on a
    // `muted` fill, and later on a 5%-primary wash one level down.
    const mismatched: string[] = [];

    for (const { path, line, self, utilities } of inkUsages()) {
      const { variant, prefix, role } = self;
      if (prefix !== "text" || !isInkOnItsOwnFill(role)) continue;

      const partner = role.slice(0, -"-foreground".length);
      const fills = utilities.filter(
        candidate =>
          candidate.prefix === "bg" &&
          candidate.state === self.state &&
          // `transparent` names no surface: the fill comes from an ancestor.
          candidate.role !== "transparent"
      );
      // No fill in this state means the surface comes from an ancestor, which
      // this cannot see. Only a fill named ALONGSIDE the ink is judged.
      if (fills.length === 0) continue;
      const declaredFor = surfacesFor(partner);
      if (fills.some(fill => declaredFor.includes(fill.role))) continue;

      mismatched.push(
        `${variant}text-${role} is painted on ` +
          `${fills.map(f => `bg-${f.role}`).join(" / ")} — ${path}:${line}`
      );
    }

    expect(
      mismatched,
      `Ink declared for one surface is painted on another. Use the fill its ` +
        `token names, or an ink token declared for the fill actually used.`
    ).toEqual([]);
  });

  it("keeps on-fill ink legible while the fill changes state", () => {
    // A `hover:bg-*` swaps the surface and leaves the label where it is, so the
    // resting pair being fine says nothing about the hovered one. It is a real
    // blind spot rather than a hypothetical: a destructive button darkened its
    // fill on hover, which moves AWAY from a white label in light mode and INTO
    // a black one in dark, and read at 3.70:1 for as long as the pointer was
    // over it.
    const failures: string[] = [];

    for (const { path, line, self, utilities } of inkUsages()) {
      const { prefix, role } = self;
      if (prefix !== "text" || !isInkOnItsOwnFill(role)) continue;
      // Only ink with no state of its own persists across the others. Ink
      // written for a specific state is judged against that state's fill by
      // the pairing check above.
      if (self.state !== "") continue;

      for (const [mode, tokens] of [
        ["light", light],
        ["dark", dark],
      ] as const) {
        if (!(mode === "dark" ? self.appliesInDark : self.appliesInLight)) {
          continue;
        }
        const ink = colorOf(role, tokens);
        if (!ink) continue;

        for (const fill of utilities) {
          if (fill.prefix !== "bg" || fill.translucent) continue;
          if (fill.role === "transparent") continue;
          if (!(mode === "dark" ? fill.appliesInDark : fill.appliesInLight)) {
            continue;
          }
          const surface = colorOf(fill.role, tokens);
          if (!surface) continue;
          const ratio = contrastRatio(ink, surface);
          if (ratio >= REQUIRED.text) continue;
          // Read from the same accepted set as everything else. The resting
          // pair being accepted does NOT excuse a state fill: this only skips
          // when the exact ink/fill combination is recorded, so a hover fill
          // that moves further from the label is still reported.
          const accepted = acceptedFor(role, fill.role, mode);
          if (accepted) {
            observed.push({
              accepted,
              ratio,
              required: REQUIRED.text,
              where: `${path}:${line}`,
            });
            continue;
          }
          failures.push(
            `text-${role} on ${fill.variant}bg-${fill.role} = ` +
              `${ratio.toFixed(2)}:1 (${mode}), needs ${REQUIRED.text}:1 — ` +
              `${path}:${line}`
          );
        }
      }
    }

    expect(
      [...new Set(failures)].sort(),
      `A label stays put while its background changes on hover, focus or ` +
        `press. Pick a state fill that moves away from the label in BOTH ` +
        `modes, or give the label a matching state variant.`
    ).toEqual([]);
  });

  it("paints no ink that fails its minimum on a surface it can land on", () => {
    const worst = new Map<string, Miss>();
    for (const miss of misses) {
      const key = `${miss.where} ${miss.utility}`;
      const seen = worst.get(key);
      if (!seen || miss.ratio < seen.ratio) worst.set(key, miss);
    }
    const reported = [...worst.values()].sort((a, b) => a.ratio - b.ratio);

    expect(
      reported.map(
        m =>
          `${m.utility} = ${m.ratio.toFixed(2)}:1 on ${m.surface} (${m.mode}), ` +
          `needs ${m.required}:1 — ${m.where}`
      ),
      `A component paints ink with a token that is not readable on a surface it ` +
        `can be rendered on. The token-pair suite cannot see this: it checks the ` +
        `pairs the theme declares, and this is a pair only the component makes. ` +
        `Use an ink token (foreground, muted-foreground) or, for a focus ` +
        `indicator, \`ring-ring\`.`
    ).toEqual([]);
  });
});
