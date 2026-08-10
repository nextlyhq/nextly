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

import { contrastRatio, type Rgb } from "../color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { resolveColor } from "../resolve";

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
 * `text-muted/10` and `ring-muted/5` are chart tracks and decorative washes: an
 * explicit opacity modifier is the author saying this is not carrying meaning.
 * Utilities WITHOUT a modifier are the ones asserted; a modifier is how a
 * deliberate exception is written, and it is visible in the diff.
 */
/**
 * A utility, with its variant chain, ending at a quote, whitespace, `}` or the
 * end of the string.
 *
 * `|$` is load-bearing: a class string's LAST utility has nothing after it, so
 * a lookahead demanding a delimiter skips it. Every `dark:text-*` written last
 * in its string -- which is where a dark override is conventionally written --
 * went unseen, and the check then measured the light ink it was supposed to
 * replace against the dark surface.
 *
 * An opacity modifier (`text-muted/10`) fails the delimiter and so is excluded:
 * chart tracks and decorative washes are the author saying this carries no
 * meaning, and it is visible in the diff when someone writes one.
 */
const INK_UTILITY =
  /(?:^|[\s"'`])((?:[a-z][a-z0-9-]*:)*)(text|ring|decoration|caret|placeholder)-([a-z][a-z0-9-]*?)!?(?=["'\s`}]|$)/g;

/**
 * `bg-<role>` in the same class string: the fill the ink is painted on.
 *
 * Matches a trailing opacity modifier rather than skipping it. A translucent
 * `dark:bg-warning-950/40` still OVERRIDES the light fill in dark mode even
 * though its composited colour is not knowable statically, and dropping it from
 * the scan left the light fill looking like it still applied -- so dark ink was
 * scored against a light background it is never painted on.
 */
const FILL_UTILITY =
  /(?:^|[\s"'`])((?:[a-z][a-z0-9-]*:)*)bg-([a-z][a-z0-9-]*?)(\/(?:\[[0-9.]+%?\]|\d+))?!?(?=["'\s`}]|$)/g;

/**
 * Files that apply classes. A module that only DESCRIBES utilities -- a doc
 * comment quoting `bg-warning-100 text-warning-700` as an example -- renders
 * nothing, and reading its prose as markup reports a component that does not
 * exist.
 */
const APPLIES_CLASSES = /className|class=|\bcva\(|\bcn\(/;

/**
 * The class string an ink utility sits in, bounded by the nearest quote on
 * either side.
 *
 * A component that names its own fill has already answered the question this
 * check asks: `bg-foreground text-background` is an inverted pill, correct at
 * 20.41:1, and measuring its ink against the PAGE would reject it for being
 * right. Reading the pair out of the class string is the same principle the
 * whole check rests on -- measure what the component renders, not what the
 * theme declares.
 */
function classStringAround(source: string, index: number): string {
  const isQuote = (char: string) =>
    char === '"' || char === "'" || char === "`";
  let start = index;
  while (start > 0 && !isQuote(source[start - 1] ?? "")) start--;
  let end = index;
  while (end < source.length && !isQuote(source[end] ?? "")) end++;
  return source.slice(start, end);
}

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
 * An `-foreground` token is painted on its own partner, not on the page:
 * `primary-foreground` is white BECAUSE it sits on the primary fill, and
 * measuring it against the page would reject it for being correct. Those pairs
 * are the token-pair suite's subject.
 *
 * The exception is a partner of a surface that IS a page backdrop --
 * `foreground` on `background`, `muted-foreground` on `muted` -- which is page
 * ink and stays in scope.
 */
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

function isInkOnItsOwnFill(role: string): boolean {
  if (!role.endsWith("-foreground")) return false;
  const partner = role.slice(0, -"-foreground".length);
  return !surfacesFor(partner).some(name =>
    PAGE_SURFACES.includes(`--nx-${name}`)
  );
}

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

interface Utility {
  /** `text`, `ring`, `bg`, ... */
  prefix: string;
  /** The colour role: `destructive-700`, `muted-foreground`. */
  role: string;
  /** Variant chain as written, e.g. `dark:hover:`. */
  variant: string;
  /** Variants other than `dark`, which is what makes two utilities siblings. */
  state: string;
  /** A translucent fill composites over what is behind it: not knowable here. */
  translucent: boolean;
  appliesInDark: boolean;
  appliesInLight: boolean;
  index: number;
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

function parseUtilities(classString: string): Utility[] {
  const found: Utility[] = [];
  const collect = (pattern: RegExp, fixedPrefix?: string) => {
    for (const match of classString.matchAll(pattern)) {
      const variant = match[1] ?? "";
      const prefix = fixedPrefix ?? match[2] ?? "";
      const role = (fixedPrefix ? match[2] : match[3]) ?? "";
      found.push({
        prefix,
        role,
        variant,
        state: variant
          .split(":")
          .filter(part => part && part !== "dark")
          .join(":"),
        translucent: Boolean(fixedPrefix && match[3]),
        appliesInDark: true,
        appliesInLight: true,
        index: match.index,
      });
    }
  };
  collect(INK_UTILITY);
  collect(FILL_UTILITY, "bg");
  return withModes(found);
}

const misses: Miss[] = [];
const resolvedRoles = new Set<string>();
const unresolvedRoles = new Set<string>();

for (const path of sources) {
  const source = readFileSync(resolve(repo, path), "utf8");
  if (!APPLIES_CLASSES.test(source)) continue;
  for (const match of source.matchAll(INK_UTILITY)) {
    const [, variant = "", prefix = "", role = ""] = match;
    const utility = `${variant}${prefix}-${role}`;
    if (isInkOnItsOwnFill(role)) continue;

    const required = prefix === "ring" ? REQUIRED.ring : REQUIRED.text;
    let resolvedAny = false;

    const classString = classStringAround(source, match.index);
    const utilities = parseUtilities(classString);
    const self = utilities.find(
      candidate =>
        candidate.prefix === prefix &&
        candidate.role === role &&
        candidate.variant === variant
    );

    for (const [mode, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      if (
        self &&
        !(mode === "dark" ? self.appliesInDark : self.appliesInLight)
      ) {
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
      const sameState = fills.filter(
        fill => fill.state === (self?.state ?? "")
      );
      const inherited = fills.filter(fill => fill.state === "");
      const effective = sameState.length > 0 ? sameState : inherited;

      // A translucent fill composites over whatever is behind it, which this
      // cannot know. It still counts as the fill for the mode -- so rather than
      // measure against a background that is not there, fall through to the
      // page surfaces, which is where the blend ends up anyway.
      const named = effective.some(fill => fill.translucent)
        ? []
        : [...new Set(effective.map(fill => `--nx-${fill.role}`))];

      const measured = ratiosFor(
        role,
        tokens,
        named.length > 0 ? named : undefined
      );
      if (!measured) continue;
      resolvedAny = true;
      const best = Math.max(...measured.values());
      if (named.length > 0 && best >= required) continue;
      for (const [surface, ratio] of measured) {
        if (ratio >= required) continue;
        const line = source.slice(0, match.index).split("\n").length;
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
  it("scans the components and resolves tokens on both sides", () => {
    // Every assertion below is vacuously true over an empty scan, so a renamed
    // directory or a changed utility syntax must fail here first.
    expect(sources.length).toBeGreaterThan(100);
    expect(resolvedRoles.size).toBeGreaterThan(3);
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

    for (const path of sources) {
      const source = readFileSync(resolve(repo, path), "utf8");
      if (!APPLIES_CLASSES.test(source)) continue;

      for (const match of source.matchAll(INK_UTILITY)) {
        const [, variant = "", prefix = "", role = ""] = match;
        if (prefix !== "text" || !isInkOnItsOwnFill(role)) continue;

        const partner = role.slice(0, -"-foreground".length);
        const utilities = parseUtilities(
          classStringAround(source, match.index)
        );
        const self = utilities.find(
          candidate =>
            candidate.prefix === "text" &&
            candidate.role === role &&
            candidate.variant === variant
        );
        const fills = utilities.filter(
          candidate =>
            candidate.prefix === "bg" &&
            candidate.state === (self?.state ?? "") &&
            // `transparent` names no surface: the fill comes from an ancestor.
            candidate.role !== "transparent"
        );
        // No fill in this state means the surface comes from an ancestor, which
        // this cannot see. Only a fill named ALONGSIDE the ink is judged.
        if (fills.length === 0) continue;
        const declaredFor = surfacesFor(partner);
        if (fills.some(fill => declaredFor.includes(fill.role))) continue;

        const line = source.slice(0, match.index).split("\n").length;
        mismatched.push(
          `${variant}text-${role} is painted on ` +
            `${fills.map(f => `bg-${f.role}`).join(" / ")} — ${path}:${line}`
        );
      }
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

    for (const path of sources) {
      const source = readFileSync(resolve(repo, path), "utf8");
      if (!APPLIES_CLASSES.test(source)) continue;

      for (const match of source.matchAll(INK_UTILITY)) {
        const [, variant = "", prefix = "", role = ""] = match;
        if (prefix !== "text" || !isInkOnItsOwnFill(role)) continue;

        const utilities = parseUtilities(
          classStringAround(source, match.index)
        );
        const self = utilities.find(
          candidate =>
            candidate.prefix === "text" &&
            candidate.role === role &&
            candidate.variant === variant
        );
        // Only ink with no state of its own persists across the others. Ink
        // written for a specific state is judged against that state's fill by
        // the pairing check above.
        if (self?.state !== "") continue;

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
            const line = source.slice(0, match.index).split("\n").length;
            failures.push(
              `text-${role} on ${fill.variant}bg-${fill.role} = ` +
                `${ratio.toFixed(2)}:1 (${mode}), needs ${REQUIRED.text}:1 — ` +
                `${path}:${line}`
            );
          }
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
