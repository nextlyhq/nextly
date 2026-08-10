/**
 * Scores a theme against the same WCAG pairings CI enforces on the shipped
 * tokens, by re-expressing it as the `:root` / `.dark` shape the shared parser
 * reads. Reusing that harness rather than reimplementing it means a theme is
 * judged by exactly the rule the design system already commits to, including
 * alpha compositing and color-mix() shade evaluation.
 *
 * The contrast modules live under `packages/ui/src/styles/contrast/` but are
 * internal to `@nextlyhq/ui` — its `exports` map only publishes ".",
 * "./tailwind-preset", "./utils", and the compiled CSS files, so there is no
 * subpath that resolves to this source from another workspace package. The
 * import below reaches into the source directly rather than duplicating the
 * WCAG math here.
 */
import {
  compositeOver,
  contrastRatio,
  type Rgb,
} from "../../../../packages/ui/src/styles/contrast/color";
import {
  PAIRINGS,
  THRESHOLDS,
} from "../../../../packages/ui/src/styles/contrast/pairings";
import {
  parseThemeScale,
  parseThemeTokens,
} from "../../../../packages/ui/src/styles/contrast/parse-theme";
import {
  applyOpacity,
  resolveColor,
  type ResolveContext,
} from "../../../../packages/ui/src/styles/contrast/resolve";

import type { ThemeDefinition, ThemeTokens } from "./types";

export interface ContrastFailure {
  mode: "light" | "dark";
  label: string;
  ratio: number;
  required: number;
}

const OPAQUE_BASE: Rgb = { r: 1, g: 1, b: 1, alpha: 1 };

const opaque = (c: Rgb, base: Rgb): Rgb =>
  c.alpha < 1 ? compositeOver(c, base) : c;

function block(selector: string, tokens: ThemeTokens): string {
  const body = Object.entries(tokens)
    .map(([name, value]) => `--nx-${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

/**
 * The parser only recognises `:root` and `.dark`, so the theme is rendered into
 * those selectors. Derived shadow strengths are included because a pairing may
 * reference them transitively.
 */
function syntheticCss(theme: ThemeDefinition): string {
  return [block(":root", theme.light), block(".dark", theme.dark)].join("\n\n");
}

/** One pairing's measured result, whether it passed or not. */
export interface ContrastMeasurement extends ContrastFailure {
  /** `ratio - required`. Negative is a failure; near zero is a fragile pass. */
  margin: number;
}

/**
 * Every pairing's ratio, passes included.
 *
 * A miss COUNT collapses a continuous quantity into a boolean: a theme
 * clearing every pairing by 0.01 and one clearing by 1.4 both report zero
 * failures, and they are not the same asset. The first flips back to failing
 * the moment the contrast source moves, a pairing is restated, or colour
 * resolution changes by a rounding step -- exactly what the revision stamp on
 * the generated report exists to detect. Keeping the margins lets a report
 * say how STABLE a pass is rather than only that it passed.
 *
 * `validateTheme` is this function filtered, so the two cannot disagree about
 * what a failure is.
 */
export function measureTheme(
  theme: ThemeDefinition,
  themeCssSource: string
): ContrastMeasurement[] {
  const { light, dark } = parseThemeTokens(syntheticCss(theme));
  // The `--color-*` scale is theme-independent text (aliases and color-mix
  // shades); only the `--nx-*` it references change per theme, so it is read
  // once from the shipped stylesheet.
  const scale = parseThemeScale(themeCssSource);

  const results: ContrastMeasurement[] = [];

  for (const mode of [
    { name: "light" as const, tokens: light },
    { name: "dark" as const, tokens: dark },
  ]) {
    const ctx: ResolveContext = { tokens: mode.tokens, scale };

    for (const pairing of PAIRINGS) {
      if (pairing.mode !== undefined && pairing.mode !== mode.name) continue;

      let surface = resolveColor(`var(${pairing.bg})`, ctx);
      if (pairing.bgAlpha !== undefined) {
        const over = resolveColor(
          `var(${pairing.bgOver ?? "--color-background"})`,
          ctx
        );
        surface = compositeOver(
          applyOpacity(surface, pairing.bgAlpha),
          opaque(over, OPAQUE_BASE)
        );
      } else {
        surface = opaque(surface, OPAQUE_BASE);
      }

      let fg = resolveColor(`var(${pairing.fg})`, ctx);
      if (pairing.fgAlpha !== undefined) fg = applyOpacity(fg, pairing.fgAlpha);
      fg = opaque(fg, surface);

      const ratio = contrastRatio(fg, surface);
      const required = THRESHOLDS[pairing.kind];
      results.push({
        mode: mode.name,
        label: pairing.label,
        ratio,
        required,
        margin: ratio - required,
      });
    }
  }

  return results;
}

/** The pairings a theme fails. `measureTheme`, filtered. */
export function validateTheme(
  theme: ThemeDefinition,
  themeCssSource: string
): ContrastFailure[] {
  return measureTheme(theme, themeCssSource).filter(r => r.ratio < r.required);
}
