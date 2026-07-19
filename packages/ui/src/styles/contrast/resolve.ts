/**
 * Resolves any color expression the theme uses to a concrete sRGB color for one
 * mode: a bare literal (`oklch(...)`, `#fff`), a `var(--nx-*)` / `var(--color-*)`
 * reference (followed transitively), or a `color-mix(in srgb, ...)` shade.
 *
 * This is what lets the contrast check assert the colors the admin actually
 * renders, including the `color-mix()` status shades that badges and alerts use
 * (`bg-warning-100 text-warning-700`) rather than only the base `--nx-*` tokens.
 */
import { toClampedRgb, type Rgb } from "./color";
import { type TokenMap } from "./parse-theme";

/** The two lookup tables for one mode: base tokens and `@theme` utility colors. */
export interface ResolveContext {
  /** `--nx-*` tokens for the mode (`:root`, or `:root` overlaid with `.dark`). */
  tokens: TokenMap;
  /** `--color-*` definitions from `@theme inline` (aliases and color-mix shades). */
  scale: TokenMap;
}

const VAR_REF = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
const COLOR_MIX = /^color-mix\(\s*in\s+srgb\s*,\s*(.+)\)$/i;

/** Split a comma-separated argument list, ignoring commas nested in parens. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/**
 * A `color-mix()` component: a color and its optional explicit percentage. Per
 * CSS Color 5, when only one side states a percentage the other is its
 * complement, so a single `white 90%` means 10% of the first color.
 */
interface MixPart {
  color: string;
  pct: number | null;
}

function parseMixPart(part: string): MixPart {
  const m = /\s(\d+(?:\.\d+)?)%$/.exec(part);
  if (m) {
    return { color: part.slice(0, m.index).trim(), pct: Number(m[1]) };
  }
  return { color: part, pct: null };
}

function mixSrgb(a: Rgb, b: Rgb, bWeight: number): Rgb {
  const aw = 1 - bWeight;
  return {
    r: a.r * aw + b.r * bWeight,
    g: a.g * aw + b.g * bWeight,
    b: a.b * aw + b.b * bWeight,
    alpha: 1,
  };
}

/**
 * Resolve a color expression to sRGB within one mode. Throws on an unresolvable
 * reference or an unsupported color-mix shape so a broken theme surfaces as a
 * clear error rather than a silently skipped assertion.
 */
export function resolveColor(
  expr: string,
  ctx: ResolveContext,
  seen: Set<string> = new Set()
): Rgb {
  const value = expr.trim();

  const varMatch = VAR_REF.exec(value);
  if (varMatch) {
    const ref = varMatch[1];
    if (seen.has(ref)) {
      throw new Error(`circular var() reference through ${ref}`);
    }
    seen.add(ref);
    // A `--color-*` alias may reference a `--nx-*` token (or vice versa), so the
    // lookup hops between maps by prefix. Take the raw value and recurse; this
    // function (not `resolveToken`) follows the reference so cross-map hops work.
    const map: TokenMap = ref.startsWith("--color-") ? ctx.scale : ctx.tokens;
    const raw = map.get(ref);
    if (raw === undefined) {
      throw new Error(`color reference not found: ${ref}`);
    }
    return resolveColor(raw, ctx, seen);
  }

  const mixMatch = COLOR_MIX.exec(value);
  if (mixMatch) {
    const args = splitTopLevel(mixMatch[1]);
    if (args.length !== 2) {
      throw new Error(`unsupported color-mix arity: ${value}`);
    }
    const a = parseMixPart(args[0]);
    const b = parseMixPart(args[1]);
    // Normalize the two weights to sum to 1, filling a missing side with its
    // complement (CSS default), matching how the browser evaluates the mix.
    // Each branch tests the value it uses so the null cases narrow cleanly.
    const aPct = a.pct;
    const bPct = b.pct;
    let bWeight: number;
    if (aPct !== null && bPct !== null) bWeight = bPct / (aPct + bPct);
    else if (bPct !== null) bWeight = bPct / 100;
    else if (aPct !== null) bWeight = 1 - aPct / 100;
    else bWeight = 0.5;
    // Both operands go through resolveColor so either side may be a keyword
    // (culori parses `white`/`black`), a literal, or a `var()` reference; the
    // theme keeps the keyword second today, but neither position is assumed.
    const colorA = resolveColor(a.color, ctx, new Set(seen));
    const colorB = resolveColor(b.color, ctx, new Set(seen));
    return mixSrgb(colorA, colorB, bWeight);
  }

  return toClampedRgb(value);
}

/**
 * Apply a Tailwind opacity utility (`token/NN`) to a color. Tailwind v4 emits
 * `color-mix(in oklab, <color> NN%, transparent)`, which scales the color's
 * existing alpha rather than overwriting it, so a translucent token like
 * `--nx-border` (0.445 alpha) under `/50` renders at ~0.22, not 0.50. Multiply
 * so the check models the pixels the browser actually paints; an opaque base
 * (alpha 1) is unaffected.
 */
export function applyOpacity(rgb: Rgb, factor: number): Rgb {
  return { r: rgb.r, g: rgb.g, b: rgb.b, alpha: rgb.alpha * factor };
}
