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

/**
 * Determine the best foreground color (white or dark) for readable text on
 * the given background hex color, using WCAG relative luminance.
 *
 * Returns a CSS color:
 * - "hsl(0 0% 100%)"          → white (used on dark/saturated backgrounds)
 * - "hsl(222.2 47.4% 11.2%)"  → slate-900 (used on light backgrounds)
 */
export function getForegroundForBackground(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  // Compare contrast ratios against pure white (L=1) and slate-900 (L≈0.017)
  const whiteContrast = 1.05 / (L + 0.05);
  const darkContrast = (L + 0.05) / 0.05;

  return whiteContrast >= darkContrast
    ? "hsl(0 0% 100%)"
    : "hsl(222.2 47.4% 11.2%)";
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
