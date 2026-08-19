import { checkContrast } from "@nextlyhq/blocks-engine";

/**
 * Color utility functions for admin branding.
 *
 * Emits complete CSS color values. The `--nx-*` design tokens hold full colors
 * (`--nx-primary: oklch(...)`) and are consumed directly, e.g.
 * `--color-primary: var(--nx-primary)`, so a bare "H S% L%" triplet would land
 * in `background-color` as an invalid value and be dropped.
 */

/**
 * Convert a 6-digit hex color string to a CSS `hsl()` color.
 *
 * @example hexToCssColor("#6366f1") → "hsl(238.7 83.5% 66.7%)"
 */
export function hexToCssColor(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  const hDeg = Math.round(h * 360 * 10) / 10;
  const sPct = Math.round(s * 100 * 10) / 10;
  const lPct = Math.round(l * 100 * 10) / 10;

  return `hsl(${hDeg} ${sPct}% ${lPct}%)`;
}

/** Foreground candidates: the hex the ratio is measured from, and the CSS emitted.
 *
 * Two spellings because they answer different questions. `checkContrast` parses
 * hex and `rgb()` and NOT `hsl()`, so the measurement takes the hex; the tokens
 * hold complete CSS colors, so the emitted value stays the `hsl()` form the
 * theme and the existing branding contract already use.
 */
const WHITE = { hex: "#ffffff", css: "hsl(0 0% 100%)" };
/** slate-900 — the designed dark tone, softer than black and preferred when it passes. */
const SLATE_900 = { hex: "#0f172a", css: "hsl(222.2 47.4% 11.2%)" };
/** Pure black, the maximum-contrast dark. Only reached when the designed pair fails. */
const BLACK = { hex: "#000000", css: "hsl(0 0% 0%)" };

/**
 * The measured ratio between a candidate and the background, or 0 when either
 * colour cannot be read.
 *
 * Zero rather than a thrown error or a default verdict: an unreadable input
 * must not be able to WIN a comparison, and every caller here validates the
 * background with `isValidHex` first, so this is a floor rather than a path.
 */
function ratioAgainst(background: string, candidateHex: string): number {
  return checkContrast(candidateHex, background)?.ratio ?? 0;
}

/** WCAG 2.2 AA for normal-size text. Buttons and labels are normal text. */
const AA_NORMAL_TEXT = 4.5;

/**
 * The most readable foreground for text on the given background.
 *
 * Prefers the designed pair — white or slate-900 — and takes whichever has the
 * higher measured contrast. When NEITHER reaches AA it escalates to the
 * higher-contrast extreme, because if neither extreme clears the threshold then
 * no foreground can and the brand colour itself is what cannot carry text.
 *
 * The escalation fires only where the designed pair would otherwise ship a
 * failing pair, so a brand whose palette already works is unaffected. A mid-tone
 * brand is where it matters: `#6366f1` gives white 4.47 and slate-900 4.00, both
 * under 4.5, while black reaches 4.70.
 *
 * The previous implementation compared white against `1.05 / (L + 0.05)` and the
 * dark tone against `(L + 0.05) / 0.05` — the second being the ratio against
 * pure BLACK while the value returned was slate-900. It chose by a number the
 * result never had, so `#6366f1` was given slate-900 believing 4.70 and shipping
 * 4.00.
 */
export function getForegroundForBackground(hex: string): string {
  const white = ratioAgainst(hex, WHITE.hex);
  const preferred =
    white >= ratioAgainst(hex, SLATE_900.hex) ? WHITE : SLATE_900;

  if (ratioAgainst(hex, preferred.hex) >= AA_NORMAL_TEXT) return preferred.css;

  return white >= ratioAgainst(hex, BLACK.hex) ? WHITE.css : BLACK.css;
}

/**
 * Validate that a string is a 6-digit hex color (e.g. "#6366f1").
 */
export function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Generate a CSS string that sets admin branding custom properties on
 * `.nextly-admin`, the class the admin root renders and that the admin
 * stylesheet is scoped to. Intended to be injected as a `<style>` tag in the
 * server-side layout so colors are present in the initial HTML —
 * no FOUC while waiting for the client-side `/admin-meta` fetch.
 *
 * @example
 * ```tsx
 * // app/admin/[[...params]]/layout.tsx (server component)
 * import config from '../../../../nextly.config';
 * import { getBrandingCss } from 'nextly/config';
 *
 * export default function AdminLayout({ children }) {
 *   const css = getBrandingCss(config.admin?.branding);
 *   return (
 *     <>
 *       {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
export function getBrandingCss(
  branding: { colors?: { primary?: string; accent?: string } } | undefined
): string | null {
  const colors = branding?.colors;
  if (!colors || (!colors.primary && !colors.accent)) return null;

  const rules: string[] = [];

  if (colors.primary && isValidHex(colors.primary)) {
    const hsl = hexToCssColor(colors.primary);
    const fg = getForegroundForBackground(colors.primary);
    rules.push(`--nx-primary: ${hsl};`);
    rules.push(`--nx-primary-foreground: ${fg};`);
    rules.push(`--nx-ring: ${hsl};`);
    rules.push(`--nx-focus-ring: ${hsl};`);
    rules.push(`--nx-sidebar-ring: ${hsl};`);
    rules.push(`--nx-chart-1: ${hsl};`);
  }

  if (colors.accent && isValidHex(colors.accent)) {
    const hsl = hexToCssColor(colors.accent);
    const fg = getForegroundForBackground(colors.accent);
    rules.push(`--nx-accent: ${hsl};`);
    rules.push(`--nx-accent-foreground: ${fg};`);
    rules.push(`--nx-chart-2: ${hsl};`);
  }

  if (rules.length === 0) return null;

  return `.nextly-admin, .nextly-admin.dark { ${rules.join(" ")} }`;
}
